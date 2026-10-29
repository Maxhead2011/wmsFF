import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// FIX: additive own-WMS guard; a marking identity is case-sensitive and client-scoped.
export const clientKizGuardEnabled = () => process.env.WMS_KIZ_CLIENT_GUARD_ENABLED === 'true';
export function clientKizIdentity(value: string): string {
  const normalized = String(value ?? '').trim().replace(/^\]d2/i, '').replace(/<GS>/gi, '\u001d')
    .replace(/^\(01\)(\d{14})\(21\)/, '01$121').replace(/^(01\d{14})\u001d21/, '$121');
  return /^(01\d{14}21(?:[^\u0000-\u001f]{13}|[^\u0000-\u001f]{6}))(?=$|\u001d|91[^\u0000-\u001f]{4}(?:\u001d)?92)/.exec(normalized)?.[1] ?? '';
}
export function clientKizPrefixes(identity: string): string[] {
  const separated = identity.slice(0, 16) + '\u001d' + identity.slice(16);
  // FIX: historical scanner prefixes may coexist with parenthesized or textual GS forms.
  const forms = [identity, separated, ...['<GS>', '<Gs>', '<gS>', '<gs>'].map(gs => separated.replace('\u001d', gs)),
    '(01)' + identity.slice(2, 16) + '(21)' + identity.slice(18)];
  return ['', ']d2', ']D2'].flatMap(prefix => forms.map(form => prefix + form));
}
const escapedPrefix = (value: string) => value.replace(/[\\%_]/g, '\\$&');
export const clientKizFilter = (identity: string, field = 'value') => ({
  OR: clientKizPrefixes(identity).map(prefix => ({ [field]: { startsWith: escapedPrefix(prefix) } })),
});
export type ClientKizDuplicateInfo = {
  identity: string; firstReceivedAt: string | null; firstBoxCode: string | null;
  firstWarehouseId: string | null; productName: string | null; barcode: string | null;
  currentStatus: string | null; currentBoxCode: string | null; currentWarehouseId: string | null;
  source: string; multipleRecords?: boolean; detailsRestricted?: boolean;
};
const iso = (value: unknown) => value ? new Date(value as string).toISOString() : null;
const emptyInfo = (identity: string): ClientKizDuplicateInfo => ({ identity, firstReceivedAt: null,
  firstBoxCode: null, firstWarehouseId: null, productName: null, barcode: null,
  currentStatus: null, currentBoxCode: null, currentWarehouseId: null, source: 'LEGACY_UNKNOWN' });

export function receiptKizDuplicateMessage(info: ClientKizDuplicateInfo): string {
  const lines = ['ОТЛОЖИТЕ ТОВАР. ДУБЛЬ КИЗ — ТОВАР НЕ ПРИНЯТ.'];
  if (info.firstReceivedAt) lines.push(`Ранее принят: ${new Date(info.firstReceivedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК).`);
  else lines.push('КИЗ уже зарегистрирован. Первоначальная приёмка не установлена.');
  if (info.firstBoxCode) lines.push(`Короб при приёмке: ${info.firstBoxCode}.`);
  if (info.productName) lines.push(`Товар: ${info.productName}${info.barcode ? `; ШК ${info.barcode}` : ''}.`);
  const statuses: Record<string, string> = { AVAILABLE: 'на складе', RECEIVING: 'в приёмке', RESERVED: 'зарезервирован',
    PACKING: 'в сборке', SHIPPING: 'готов к отгрузке', SHIPPED: 'отгружен', BLOCKED: 'заблокирован', AMBIGUOUS: 'несколько записей' };
  if (info.currentStatus) lines.push(`Сейчас: ${statuses[info.currentStatus] ?? info.currentStatus}${info.currentBoxCode ? `, короб ${info.currentBoxCode}` : ''}.`);
  if (info.detailsRestricted) lines.push('Подробности другого филиала доступны уполномоченному администратору.');
  lines.push('Передайте товар на проверку КИЗ.');
  return lines.join('\n');
}
export class ClientKizDuplicateError extends ConflictException {
  constructor(public readonly duplicateInfo: ClientKizDuplicateInfo) {
    super({ code: 'KIZ_DUPLICATE', duplicate: true, message: receiptKizDuplicateMessage(duplicateInfo), duplicateInfo });
  }
}

function visibleInfo(info: ClientKizDuplicateInfo, warehouseId?: string | null): ClientKizDuplicateInfo {
  if (!warehouseId) return info;
  const firstHidden = !!info.firstWarehouseId && info.firstWarehouseId !== warehouseId;
  const currentHidden = !!info.currentWarehouseId && info.currentWarehouseId !== warehouseId;
  return { ...info, ...(firstHidden ? { firstBoxCode: null, productName: null, barcode: null, firstWarehouseId: null } : {}),
    ...(currentHidden ? { currentBoxCode: null, currentWarehouseId: null } : {}), detailsRestricted: firstHidden || currentHidden };
}

// FIX: read-only lookup. Immutable registry survives deletion/relabel of a ProductMark.
export async function lookupClientKiz(db: any, clientId: string, kiz: string, warehouseId?: string | null): Promise<ClientKizDuplicateInfo | null> {
  const identity = clientKizIdentity(kiz);
  if (!identity) throw new BadRequestException('Не удалось распознать GTIN и серийный номер КИЗ. Отсканируйте Data Matrix полностью.');
  const saved = await db.$queryRaw(Prisma.sql`SELECT * FROM "KizClientRegistry" WHERE "clientId"=${clientId} AND identity=${identity}`);
  const candidates = await db.productMark.findMany({ where: { clientId, ...clientKizFilter(identity) },
    include: { box: { select: { code: true, warehouseId: true } }, sku: { select: { name: true } } } });
  const marks = candidates.filter((m: any) => clientKizIdentity(m.value) === identity);
  const shipments = await db.shippedKizHistory.findMany({ where: { clientId, ...clientKizFilter(identity, 'kiz') },
    select: { kiz: true, warehouseId: true, productName: true, barcode: true }, take: 25 });
  const shipped = shipments.find((row: any) => clientKizIdentity(row.kiz) === identity);
  // Historical FBS attempts may outlive a removed ProductMark. They establish prior registration,
  // never a fabricated original receipt date or proof of shipment.
  let oldTask: any = null;
  if (!saved.length && !marks.length && !shipped && db.fbsTsdAssembly?.findMany) {
    const tasks = await db.fbsTsdAssembly.findMany({ where: { clientId, ...clientKizFilter(identity, 'kiz') },
      select: { kiz: true }, take: 25 });
    oldTask = tasks.find((row: any) => clientKizIdentity(row.kiz ?? '') === identity);
  }
  // FIX: indexed receipt evidence closes the backfill/deployment gap and survives deleted marks.
  let receipt: any = null;
  if (!saved.length) {
    const filters = clientKizPrefixes(identity).map(prefix => Prisma.sql`o.payload->>'kiz' LIKE ${escapedPrefix(prefix) + '%'}`);
    const rows = await db.$queryRaw(Prisma.sql`SELECT o.payload, m."createdAt" AS "receivedAt", m."clientId" AS "movementClientId",
      m.type, m.quantity, m."warehouseId", m."skuId", b.code AS "boxCode", s.name AS "productName"
      FROM "TsdOperation" o LEFT JOIN "StockMovement" m ON m."idempotencyKey"=o."operationKey"
      LEFT JOIN "Box" b ON b.id=m."boxId" LEFT JOIN "Sku" s ON s.id=m."skuId"
      WHERE o."operationType"='receipt_scan' AND o.status='ACCEPTED' AND o.payload->>'clientId'=${clientId}
      AND (${Prisma.join(filters, ' OR ')}) ORDER BY o."createdAt", o.id LIMIT 100`);
    receipt = rows.find((r: any) => clientKizIdentity(r.payload?.kiz ?? '') === identity);
  }
  if (!saved.length && !marks.length && !shipped && !oldTask && !receipt) return null;
  const row = saved[0];
  let info: ClientKizDuplicateInfo = row ? { ...emptyInfo(identity), firstReceivedAt: iso(row.firstReceivedAt),
    firstBoxCode: row.firstBoxCode, firstWarehouseId: row.firstWarehouseId, productName: row.productName,
    barcode: row.barcode, source: row.source } : emptyInfo(identity);
  if (!row && receipt && receipt.type === 'RECEIPT' && receipt.quantity === 1 && receipt.movementClientId === clientId &&
    (receipt.payload.boxCode ?? null) === (receipt.boxCode ?? null)) {
    info = { ...info, firstReceivedAt: iso(receipt.receivedAt), firstBoxCode: receipt.boxCode,
      firstWarehouseId: receipt.warehouseId, productName: receipt.payload.skuName ?? receipt.productName,
      barcode: receipt.payload.barcode ?? null, source: 'RECEIPT' };
  }
  if (marks.length === 1) info = { ...info, currentStatus: marks[0].status, currentBoxCode: marks[0].box?.code ?? null,
    currentWarehouseId: marks[0].box?.warehouseId ?? null };
  if (shipped && (!marks.length || marks[0].status === 'SHIPPING')) info.currentStatus = 'SHIPPED';
  if (marks.length > 1) info = { ...info, currentStatus: 'AMBIGUOUS', multipleRecords: true };
  return visibleInfo(info, warehouseId);
}

export type ClientKizReceiptInput = {
  clientId: string; kiz: string; operationKey: string; warehouseId?: string | null; skuId?: string | null;
  boxCode?: string | null; productName?: string | null; barcode?: string | null; receivedAt?: Date | null;
  sourceDocument?: string | null; userId?: string | null; source?: 'RECEIPT' | 'CORRECTION' | 'LEGACY_UNKNOWN';
};
export async function lockClientKiz(tx: any, clientId: string, identity: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['kiz-client', clientId, identity])},0))::text`);
}
export async function assertNewReceiptKiz(tx: any, input: ClientKizReceiptInput): Promise<boolean> {
  if (!clientKizGuardEnabled()) return true;
  const identity = clientKizIdentity(input.kiz);
  if (!identity) throw new BadRequestException('Не удалось распознать GTIN и серийный номер КИЗ. Отсканируйте Data Matrix полностью.');
  await lockClientKiz(tx, input.clientId, identity);
  // FIX: a concurrent retry may have waited while the identical operation committed.
  if (tx.stockMovement?.findUnique) {
    const committed = await tx.stockMovement.findUnique({ where: { idempotencyKey: input.operationKey } });
    if (committed) return false;
  }
  const prior = await lookupClientKiz(tx, input.clientId, input.kiz, input.warehouseId);
  if (prior) throw new ClientKizDuplicateError(prior);
  return true;
}
// FIX: the administrative error path writes an unmarked unit, but must retain the scanned identity.
// The stock service receives this same tx: never open a nested receipt transaction while holding the lock.
export async function withReceiptErrorKizGuard<T>(db: any, input: ClientKizReceiptInput, action: (tx: any) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx: any) => {
    const fresh = await assertNewReceiptKiz(tx, input);
    const result = await action(tx);
    if (fresh) await recordClientKizReceipt(tx, { ...input, source: 'CORRECTION' });
    return result;
  });
}
// Must run in the same transaction as the actual receipt. Unknown legacy origins keep a null date.
export async function recordClientKizReceipt(tx: any, input: ClientKizReceiptInput): Promise<void> {
  if (!clientKizGuardEnabled()) return;
  const identity = clientKizIdentity(input.kiz);
  if (!identity) throw new BadRequestException('Некорректный идентификатор КИЗ.');
  const source = input.source ?? 'RECEIPT';
  await tx.$executeRaw(Prisma.sql`INSERT INTO "KizClientRegistry"
    ("clientId",identity,"firstReceivedAt","firstBoxCode","firstWarehouseId","productName",barcode,"skuId","operationKey","sourceDocument","userId",source)
    VALUES (${input.clientId},${identity},${source === 'RECEIPT' ? input.receivedAt ?? new Date() : null},
      ${source === 'RECEIPT' ? input.boxCode ?? null : null},${input.warehouseId ?? null},${input.productName ?? null},${input.barcode ?? null},
      ${input.skuId ?? null},${input.operationKey},${input.sourceDocument ?? null},${input.userId ?? null},${source})`);
}

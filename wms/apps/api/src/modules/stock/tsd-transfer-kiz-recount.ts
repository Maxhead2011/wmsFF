import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

type Parse = (value: string) => { gtin: string; serial: string } | null;
type Db = Pick<Prisma.TransactionClient, 'productMark' | 'stockBalance' | 'fbsTsdAssembly' |
  'shippedKizHistory' | 'fbsWebKizStickerPrint' | 'fbsPrintJob' | 'fbsAssemblyAttemptHistory' | 'kizCirculationItem'>;
type Source = { id: string; code: string; clientId: string; warehouseId: string | null; palletId: string | null; status: string };
export class KizRecountReviewRequired extends Error {}
export const recountHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// FIX: full physical count is explicit; reject duplicate identities before any mutation or review creation.
export function parseRecountScans(payload: Record<string, unknown>, parse: Parse) {
  if (payload.allUnitsScanned !== true || !Array.isArray(payload.kizCodes) || !payload.kizCodes.length || payload.kizCodes.length > 200) {
    throw new BadRequestException('Подтвердите сканирование всех КИЗов выбранного товара в коробе (от 1 до 200).');
  }
  const scans = payload.kizCodes.map(value => {
    const raw = typeof value === 'string' ? value.trim() : '';
    const identity = raw.length <= 1024 ? parse(raw) : null;
    if (!identity) throw new BadRequestException('Сканируйте полный КИЗ каждой единицы выбранного товара.');
    return { raw, key: `01${identity.gtin}21${identity.serial}`, ...identity };
  }).sort((a, b) => a.key.localeCompare(b.key));
  if (new Set(scans.map(scan => scan.key)).size !== scans.length) throw new BadRequestException('Один КИЗ отсканирован повторно. Каждая единица учитывается один раз.');
  return scans;
}

// FIX: reuse stock, mark and history tables; no new inventory balance or parallel movement ledger.
export async function planKizRecount(db: Db, source: Source, skuId: string,
  scans: ReturnType<typeof parseRecountScans>, parse: Parse, administrator = false, releasedAssemblyIds: string[] = []) {
  const review = (message: string): never => { throw new KizRecountReviewRequired(message); };
  if (!source.warehouseId || !['active', 'receiving', ...(administrator ? ['archived'] : [])].includes(source.status)) review('Короб не находится в активном хранении. Нужен разбор WMS.');
  const balances = await db.stockBalance.findMany({ where: { boxId: source.id, skuId }, orderBy: { id: 'asc' } });
  if (balances.some(row => row.clientId !== source.clientId || row.warehouseId !== source.warehouseId || row.quantity < 0 ||
    (row.status !== 'AVAILABLE' && row.quantity !== 0))) review('В коробе есть резерв или недоступный остаток выбранного товара.');
  const quantity = balances.filter(row => row.status === 'AVAILABLE').reduce((sum, row) => sum + row.quantity, 0);
  if (quantity !== scans.length && !administrator) review(`Физически отсканировано ${scans.length}, доступно в WMS ${quantity}. Количество автоматически не изменено.`);
  const previousMarks = await db.productMark.findMany({ where: { boxId: source.id, skuId }, orderBy: { id: 'asc' }, take: 201 });
  if (previousMarks.length > 200 || previousMarks.some(row => row.clientId !== source.clientId || row.status !== 'AVAILABLE')) review('Состав КИЗов содержит недоступные записи. Нужен разбор WMS.');
  const variants = (gtin: string, serial: string) => [`01${gtin}21${serial}`, `]d201${gtin}21${serial}`,
    `(01)${gtin}(21)${serial}`, `01${gtin}\u001d21${serial}`, `]d201${gtin}\u001d21${serial}`, `01${gtin}<GS>21${serial}`];
  const all = [...scans];
  for (const mark of previousMarks) {
    const identity = parse(mark.value);
    if (!identity) review('Старый КИЗ имеет неполный формат. Нужен разбор WMS.');
    all.push({ raw: mark.value, key: `01${identity!.gtin}21${identity!.serial}`, ...identity! });
  }
  const identities = [...new Map(all.map(scan => [scan.key, scan])).values()];
  const prefixes = identities.flatMap(scan => variants(scan.gtin, scan.serial));
  const rows = await db.productMark.findMany({ where: { OR: prefixes.map(prefix => ({ value: { startsWith: prefix } })) }, take: 401 });
  if (rows.length > 400) review('Слишком много связанных записей КИЗ. Нужен разбор WMS.');
  const known = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const identity = parse(row.value);
    const key = identity ? `01${identity.gtin}21${identity.serial}` : '';
    if (!identities.some(scan => scan.key === key) || known.has(key) || row.clientId !== source.clientId ||
        row.skuId !== skuId || row.boxId !== source.id || row.status !== 'AVAILABLE') {
      review('КИЗ имеет другую принадлежность, статус или дублирующую запись. Нужен разбор WMS.');
    }
    known.set(key, row);
  }
  const kizWhere = { OR: prefixes.map(prefix => ({ kiz: { startsWith: prefix } })) };
  const conflicts = await Promise.all([
    db.fbsTsdAssembly.findFirst({ where: { OR: [kizWhere, { clientId: source.clientId,
      status: { in: ['IN_PROGRESS', 'RETURN_REQUIRED'] }, AND: [
        { OR: [{ skuId }, { sourceSkuId: skuId }] }, { OR: [{ boxId: source.id }, { reservedBoxId: source.id }] }] }] }, select: { id: true } }),
    db.shippedKizHistory.findFirst({ where: kizWhere, select: { id: true } }),
    // FIX: only the assemblies released in this very transaction may retain their immutable print history.
    db.fbsWebKizStickerPrint.findFirst({ where: { ...kizWhere, ...(releasedAssemblyIds.length ? { assemblyId: { notIn: releasedAssemblyIds } } : {}) }, select: { id: true } }),
    db.fbsPrintJob.findFirst({ where: { ...kizWhere, ...(releasedAssemblyIds.length ? { assemblyId: { notIn: releasedAssemblyIds } } : {}) }, select: { id: true } }),
    db.fbsAssemblyAttemptHistory.findFirst({ where: kizWhere, select: { id: true } }),
    db.kizCirculationItem.findFirst({ where: { OR: prefixes.map(prefix => ({ kizRaw: { startsWith: prefix } })) }, select: { id: true } }),
  ]);
  if (conflicts.some(Boolean)) review('Товар или один из старых/отсканированных КИЗов связан со сборкой, отгрузкой или печатью. История и остаток не изменены.');
  const selected = new Set(scans.map(scan => scan.key));
  const retired = previousMarks.filter(mark => { const id = parse(mark.value)!; return !selected.has(`01${id.gtin}21${id.serial}`); });
  const registered = scans.filter(scan => !known.has(scan.key));
  return { quantity: scans.length, previousQuantity: quantity, delta: scans.length - quantity,
    balances, previousMarks, retired, registered, snapshot: recountHash({ source: {
    id: source.id, clientId: source.clientId, warehouseId: source.warehouseId, palletId: source.palletId, status: source.status,
  }, skuId, balances, rows: [...rows].sort((a, b) => a.id.localeCompare(b.id)), scans: scans.map(scan => scan.key) }) };
}

export function requireRecountSnapshot(actual: string, supplied: unknown) {
  if (typeof supplied !== 'string' || supplied !== actual) throw new ConflictException('Другой сотрудник изменил короб или КИЗы. Повторите сверку; ничего не изменено.');
}

import { BadRequestException } from '@nestjs/common';
import { Prisma, StockStatus } from '@prisma/client';
import { createHash } from 'node:crypto';

type Db = Pick<Prisma.TransactionClient, 'productMark' | 'box' | 'fbsTsdAssembly' |
  'shippedKizHistory' | 'fbsWebKizStickerPrint' | 'clientMarketplaceConnection' | 'stockMovement'>;
type Identity = { gtin: string; serial: string };
type ParseIdentity = (value: string) => Identity | null;
export type CancelledWbTransferInput = {
  source: { id: string; code: string; clientId: string; warehouseId: string | null };
  skuId: string;
  availableQuantity: number;
  scanCode: string;
};
export type CancelledWbTransferProof = {
  input: CancelledWbTransferInput;
  fingerprint: string;
  checkedAt: number;
  orderId: string;
  connectionId: string;
  supplierStatus: string;
  wbStatus: string;
  mark: { id: string; value: string; skuId: string; boxId: string | null; status: StockStatus;
    updatedAt: Date; stockMovementId: string | null };
};

export function cancelledWbTransferEnabled() {
  // FIX: opt-in only for our WMS; old installations and ordinary transfers stay strict.
  return process.env.WMS_TSD_CANCELLED_WB_TRANSFER_ENABLED === 'true';
}

const STOP = 'Не удалось однозначно связать КИЗ с отменённым заказом WB. Перемещение не выполнено.';

async function context(db: Db, input: CancelledWbTransferInput, parse: ParseIdentity) {
  const identity = parse(input.scanCode);
  if (!identity) return null;
  const { gtin, serial } = identity;
  const prefixes = [`01${gtin}21${serial}`, `]d201${gtin}21${serial}`, `(01)${gtin}(21)${serial}`,
    `01${gtin}\u001d21${serial}`, `]d201${gtin}\u001d21${serial}`, `01${gtin}<GS>21${serial}`];
  const sameIdentity = (value: string) => {
    const found = parse(value);
    return found?.gtin === gtin && found.serial === serial;
  };
  const mark = await db.productMark.findFirst({ where: { OR: prefixes.map(prefix => ({ value: { startsWith: prefix } })) },
    select: { id: true, clientId: true, skuId: true, boxId: true, status: true, value: true, updatedAt: true, stockMovementId: true } });
  if (!mark || mark.status === StockStatus.AVAILABLE) return null;
  if (!sameIdentity(mark.value) || mark.clientId !== input.source.clientId || mark.skuId !== input.skuId ||
      ![StockStatus.SHIPPING, StockStatus.RESERVED].includes(mark.status as 'SHIPPING' | 'RESERVED') ||
      !mark.boxId || !input.source.warehouseId || input.availableQuantity < 1) {
    throw new BadRequestException(STOP);
  }
  const kizWhere = { OR: prefixes.map(prefix => ({ kiz: { startsWith: prefix } })) };
  // FIX: bound reads; reject ambiguous/repeated ownership instead of choosing one matching order.
  const archiveDb = (db as unknown as { fbsAssemblyAttemptHistory?: { findFirst(args: unknown): Promise<unknown> } }).fbsAssemblyAttemptHistory;
  if (['true', 'read-only'].includes(process.env.WMS_FBS_REPEAT_ASSEMBLY_ENABLED ?? '') && !archiveDb) {
    throw new BadRequestException(STOP);
  }
  const [oldBox, tasks, shipments, prints, registered, archived, lastMovement] = await Promise.all([
    db.box.findUnique({ where: { id: mark.boxId }, select: { id: true, clientId: true, warehouseId: true } }),
    db.fbsTsdAssembly.findMany({ where: kizWhere, take: 2, orderBy: { id: 'asc' },
      select: { id: true, clientId: true, marketplace: true, connectionId: true, orderId: true, kiz: true, status: true, updatedAt: true } }),
    db.shippedKizHistory.findMany({ where: kizWhere, take: 21, orderBy: { id: 'asc' },
      select: { id: true, clientId: true, assemblyId: true, orderId: true, kiz: true } }),
    db.fbsWebKizStickerPrint.findMany({ where: kizWhere, take: 21, orderBy: { id: 'asc' },
      select: { id: true, clientId: true, assemblyId: true, orderId: true, kiz: true } }),
    db.productMark.count({ where: { clientId: input.source.clientId, skuId: input.skuId,
      boxId: input.source.id, status: StockStatus.AVAILABLE } }),
    archiveDb ? archiveDb.findFirst({ where: kizWhere, select: { id: true } }) : null,
    mark.stockMovementId ? db.stockMovement.findUnique({ where: { id: mark.stockMovementId },
      select: { id: true, type: true, quantity: true, boxId: true } }) : null,
  ]);
  // FIX: after a physical MOVE the new location is authoritative, even with another operation ID.
  if (lastMovement?.type === 'MOVE' && lastMovement.quantity > 0 && lastMovement.boxId !== input.source.id) {
    throw new BadRequestException('Этот КИЗ уже перемещён в другой короб. Отсканируйте его текущий исходный короб.');
  }
  const task = tasks[0];
  if (!oldBox || oldBox.clientId !== input.source.clientId || oldBox.warehouseId !== input.source.warehouseId ||
      tasks.length !== 1 || !task || task.clientId !== input.source.clientId || task.marketplace !== 'WILDBERRIES' ||
      !sameIdentity(task.kiz ?? '') || shipments.length > 20 || prints.length > 20 || archived ||
      registered >= input.availableQuantity || [...shipments, ...prints].some(row =>
        row.clientId !== input.source.clientId || row.assemblyId !== task.id || row.orderId !== task.orderId || !sameIdentity(row.kiz))) {
    throw new BadRequestException(STOP);
  }
  const competing = await db.fbsTsdAssembly.findFirst({ where: {
    id: { not: task.id }, clientId: input.source.clientId, status: { in: ['IN_PROGRESS', 'RETURN_REQUIRED'] },
    AND: [{ OR: [{ skuId: input.skuId }, { sourceSkuId: input.skuId }] },
      { OR: [{ boxId: input.source.id }, { reservedBoxId: input.source.id }] }],
  }, select: { id: true } });
  if (competing) throw new BadRequestException('Товар используется другой текущей сборкой. Перемещение не выполнено.');
  const fingerprint = createHash('sha256').update(JSON.stringify({ mark, oldBox, task, shipments, prints, lastMovement })).digest('hex');
  return { mark, task, fingerprint };
}

export async function prepareCancelledWbTransfer(db: Db, input: CancelledWbTransferInput, parse: ParseIdentity): Promise<CancelledWbTransferProof | undefined> {
  if (!cancelledWbTransferEnabled()) return undefined;
  const local = await context(db, input, parse);
  if (!local) return undefined;
  const connection = await db.clientMarketplaceConnection.findUnique({ where: { id: local.task.connectionId },
    select: { clientId: true, marketplace: true, isActive: true, apiKey: true } });
  if (!connection || connection.clientId !== input.source.clientId || connection.marketplace !== 'WILDBERRIES' || !connection.isActive || !connection.apiKey) {
    throw new BadRequestException('Не удалось проверить отмену заказа WB: подключение кабинета недоступно. Повторите позже.');
  }
  const orderId = Number(local.task.orderId);
  if (!/^\d+$/.test(local.task.orderId) || !Number.isSafeInteger(orderId) || orderId <= 0) throw new BadRequestException(STOP);
  let order: { supplierStatus?: unknown; wbStatus?: unknown } | undefined;
  try {
    // FIX: read-only POST, outside the stock transaction. Never cancel orders or send KIZ metadata.
    const response = await fetch('https://marketplace-api.wildberries.ru/api/v3/orders/status', {
      method: 'POST', headers: { Authorization: connection.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: [orderId] }), signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error('WB read failed');
    const body = await response.json() as { orders?: Array<{ id?: unknown; supplierStatus?: unknown; wbStatus?: unknown }> };
    const matches = Array.isArray(body.orders) ? body.orders.filter(row => String(row.id) === local.task.orderId) : [];
    if (matches.length !== 1) throw new Error('WB order status missing or ambiguous');
    order = matches[0];
  } catch {
    // No credentials, response bodies or connection strings in errors/audit.
    throw new BadRequestException('Не удалось проверить отмену заказа WB. Связь недоступна или WB ограничил запросы. Остатки не изменены; повторите сканирование.');
  }
  const supplierStatus = typeof order?.supplierStatus === 'string' ? order.supplierStatus : '';
  const wbStatus = typeof order?.wbStatus === 'string' ? order.wbStatus : '';
  if (!['cancel', 'complete'].includes(supplierStatus) || !['canceled', 'canceled_by_client', 'declined_by_client'].includes(wbStatus)) {
    throw new BadRequestException(`WB не подтвердил отмену заказа №${local.task.orderId}. Перемещение не выполнено.`);
  }
  return { input, fingerprint: local.fingerprint, checkedAt: Date.now(), orderId: local.task.orderId,
    connectionId: local.task.connectionId, supplierStatus, wbStatus, mark: local.mark };
}

export async function validateCancelledWbTransfer(db: Db, proof: CancelledWbTransferProof, input: CancelledWbTransferInput, parse: ParseIdentity) {
  // FIX: server-local proof, never read from the request; expire before stock writes.
  if (!cancelledWbTransferEnabled() || Date.now() - proof.checkedAt > 15_000 || Date.now() < proof.checkedAt ||
      input.source.id !== proof.input.source.id || input.source.clientId !== proof.input.source.clientId ||
      input.source.warehouseId !== proof.input.source.warehouseId || input.skuId !== proof.input.skuId ||
      JSON.stringify(parse(input.scanCode)) !== JSON.stringify(parse(proof.input.scanCode))) throw new BadRequestException(STOP);
  const local = await context(db, input, parse);
  if (!local || local.fingerprint !== proof.fingerprint) {
    throw new BadRequestException('КИЗ или связанный заказ изменился после проверки WB. Повторите сканирование; остатки не изменены.');
  }
}

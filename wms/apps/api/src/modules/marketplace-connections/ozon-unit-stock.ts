import { ConflictException } from '@nestjs/common';
import { wbReservationQuantities } from '../../common/stock/wb-order-stock-lifecycle';
import { assertReceiptFbsBox } from '../warehouse/receipt-channel-policy';
import { OzonPickState, ozonActiveLine } from './ozon-fbs-pick-lines';

// FIX: a KIZ's AVAILABLE status alone does not prove remaining physical stock.
export async function assertOzonUnitStock(service: any, tx: any, task: any, state: OzonPickState) {
  const line = ozonActiveLine(state);
  const warehouseId = await service.resolveFbsTsdExpectedWarehouseId(task);
  if (!line || !state.source || !warehouseId) throw new ConflictException('Не определён источник товара или склад исполнения.');
  const boxId = state.source.boxId;
  const key = `fbs:${task.clientId}:${boxId ?? 'NO_BOX'}:${line.skuId}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  if (boxId) {
    const boxes = await tx.$queryRaw`SELECT id, "clientId", "warehouseId", status FROM "Box" WHERE id=${boxId} FOR UPDATE`;
    const box = boxes[0];
    if (!box || box.clientId !== task.clientId || box.warehouseId !== warehouseId || ['archived', 'deleted'].includes(box.status))
      throw new ConflictException('Короб перемещён, закрыт или относится к другому складу. Обновите маршрут.');
  }
  await assertReceiptFbsBox(tx, task, boxId);
  const balances = await tx.stockBalance.findMany({ where: {
    clientId: task.clientId, warehouseId, skuId: line.skuId, status: 'AVAILABLE', quantity: { gt: 0 },
    OR: [{ boxId: null }, { box: { status: { notIn: ['archived', 'deleted'] } } }],
  }, select: { boxId: true, quantity: true } });
  const sourceQuantity = balances.filter((r: any) => r.boxId === boxId).reduce((n: number, r: any) => n + r.quantity, 0);
  const ownPicked = line.picks.filter(p => p.boxId === boxId).length;
  const reservations = await service.fbsTsdReservationRowsBySku({ clientId: task.clientId,
    skuIds: [line.skuId], excludeTaskId: task.id, withoutBox: !boxId }, tx);
  // FIX: include preliminary source reservations, just as route calculation does.
  const sourceReserved = (reservations.get(line.skuId) ?? []).filter((r: any) => (r.boxId ?? r.reservedBoxId ?? null) === boxId)
    .reduce((n: number, r: any) => n + r.itemCount, 0);
  if (sourceQuantity - ownPicked - sourceReserved < 1)
    throw new ConflictException('В выбранном источнике нет свободной единицы товара. Обновите маршрут.');
  // Other requests (including FBO) retain their warehouse-wide reservations.
  const reserved = await wbReservationQuantities(tx, task.clientId, [line.skuId], warehouseId, task.requestId);
  const ownItems = await tx.clientRequestItem.findMany({ where: { requestId: task.requestId, skuId: line.skuId }, select: { quantity: true } });
  // FIX: other orders in the same request may already have left AVAILABLE.
  const physical = await tx.stockMovement.aggregate({ where: { clientId: task.clientId, warehouseId,
    skuId: line.skuId, sourceDocument: task.requestId, status: 'AVAILABLE',
    type: { in: ['PICK', 'PACK', 'SHIP', 'RETURN', 'MOVE'] } }, _sum: { quantity: true } });
  const demand = Math.max(0, ownItems.reduce((n: number, item: any) => n + item.quantity, 0) - Math.max(0, -(physical._sum.quantity ?? 0)));
  const total = balances.reduce((n: number, r: any) => n + r.quantity, 0);
  if (total - (reserved.get(line.skuId) ?? 0) < demand)
    throw new ConflictException('Остаток зарезервирован другими заявками. Требуется сверка состава заказа.');
}

// FIX: a loose mark has no box/warehouse relation; require its current movement as branch evidence.
export async function assertOzonMarkWarehouse(tx: any, mark: any, warehouseId: string) {
  if (mark.boxId) return; // Locked source-box ownership is checked by assertOzonUnitStock.
  const movement = mark.stockMovementId ? await tx.stockMovement.findUnique({ where: { id: mark.stockMovementId } }) : null;
  if (!movement || movement.clientId !== mark.clientId || movement.skuId !== mark.skuId ||
      movement.warehouseId !== warehouseId || movement.boxId !== null || movement.status !== 'AVAILABLE' || movement.quantity <= 0)
    throw new ConflictException('Не подтверждено наличие этой единицы КИЗ в выбранном филиале. Требуется проверка складского движения.');
}

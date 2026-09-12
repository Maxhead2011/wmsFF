import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WB_KIZ_SHIPMENT_PREFIX } from '../marketplace-connections/fbs-wb-kiz-shipment';

type Request = { id: string; clientId: string; items: Array<{ id: string; skuId: string | null; quantity: number }>; wbShipmentCreditsApplied?: boolean };
export type WbShippedUnit = { itemId: string; skuId: string; quantity: number; boxId: string | null;
  sourceBoxCode: string; warehouseId: string; movementId: string; shippedAt: Date };

// FIX: immutable shipment evidence remains effective even if the feature is later disabled.
export async function readWbShippedUnits(tx: Prisma.TransactionClient, request: Request, warehouseId?: string): Promise<WbShippedUnit[]> {
  if (request.wbShipmentCreditsApplied || !tx.shippedKizHistory?.findMany || !tx.fbsTsdAssembly?.findMany) return [];
  const movements = await tx.stockMovement.findMany({ where: { clientId: request.clientId, sourceDocument: request.id,
    type: 'SHIP', quantity: { lt: 0 }, idempotencyKey: { startsWith: WB_KIZ_SHIPMENT_PREFIX } } });
  const exact = movements.filter(row => row.type === 'SHIP' && row.sourceDocument === request.id &&
    row.clientId === request.clientId && row.idempotencyKey?.startsWith(WB_KIZ_SHIPMENT_PREFIX));
  if (!exact.length) return [];
  const ids = exact.map(row => row.idempotencyKey!.slice(WB_KIZ_SHIPMENT_PREFIX.length));
  const [tasks, history] = await Promise.all([
    tx.fbsTsdAssembly.findMany({ where: { id: { in: ids }, requestId: request.id, clientId: request.clientId } }),
    tx.shippedKizHistory.findMany({ where: { assemblyId: { in: ids }, requestId: request.id, clientId: request.clientId } }),
  ]);
  const used = new Map<string, number>();
  return exact.map(movement => {
    const id = movement.idempotencyKey!.slice(WB_KIZ_SHIPMENT_PREFIX.length);
    const task = tasks.find(row => row.id === id);
    const record = history.find(row => row.assemblyId === id);
    const item = request.items.find(row => row.id === task?.requestItemId && row.skuId === movement.skuId);
    if (!warehouseId || movement.warehouseId !== warehouseId || movement.quantity !== -1 || !task ||
      task.status !== 'WB_ACCOUNTED' || task.itemCount !== 1 || task.requestId !== request.id || task.clientId !== request.clientId ||
      !record || record.warehouseId !== warehouseId || record.skuId !== movement.skuId || record.orderId !== task.orderId ||
      !task.kiz || record.kiz !== task.kiz || record.barcode !== task.barcode || !item) {
      throw new ConflictException('Не удалось однозначно связать отгрузку WB с позицией заявки. Повторное списание остановлено.');
    }
    const quantity = (used.get(item.id) ?? 0) + 1;
    if (quantity > item.quantity) throw new ConflictException('Количество отгрузок WB превышает состав заявки.');
    used.set(item.id, quantity);
    return { itemId: item.id, skuId: movement.skuId, quantity: 1, boxId: task.boxId,
      sourceBoxCode: record.sourceBoxCode ?? 'Без короба', warehouseId, movementId: movement.id, shippedAt: record.shippedAt };
  });
}

export function withoutWbShippedItems<T extends Request>(request: T, shipped: WbShippedUnit[]): T {
  if (!shipped.length) return request;
  return { ...request, wbShipmentCreditsApplied: true, items: request.items.map(item => ({ ...item,
    quantity: item.quantity - shipped.filter(unit => unit.itemId === item.id).length,
  })).filter(item => item.quantity > 0) };
}

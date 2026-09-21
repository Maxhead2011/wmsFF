import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export const packedRequestShippingEnabled = () => process.env.WMS_PACKED_REQUEST_SHIPPING_ENABLED === 'true';

// FIX: prove ownership using both recorded packages and this request's shipping ledger.
// Original picking boxes cannot identify the destination boxes after repacking.
export async function readPackedShippingSources(
  tx: Prisma.TransactionClient,
  request: { id: string; clientId: string; items: Array<{ id: string; skuId: string | null; quantity: number }> },
  warehouseId: string | undefined,
) {
  if (!packedRequestShippingEnabled()) return null;
  // This table belongs to the deployed two-stage FBO module; other requests keep their existing path.
  const assemblies = await tx.$queryRaw<Array<{ phase: string }>>`SELECT "phase" FROM "FboAssembly" WHERE "requestId" = ${request.id}`;
  if (!assemblies.length) return null;
  if (assemblies[0].phase !== 'COMPLETED') throw new BadRequestException('Сначала подтвердите все короба поставки ФБО.');
  const packages = await tx.clientRequestPackage.findMany({ where: { requestId: request.id }, include: { items: true } });
  if (!packages.length) throw new BadRequestException('Не сохранены отгрузочные короба завершённой сборки ФБО.');
  if (!warehouseId) throw new BadRequestException('Не определён склад упакованной заявки.');
  const fail = () => { throw new BadRequestException('Состав отгрузочных коробов не совпадает с движениями заявки. Проверьте упаковку; повторный подбор отключён.'); };
  const boxes = await tx.box.findMany({ where: { clientId: request.clientId, warehouseId, code: { in: packages.map(p => p.packageCode) } }, select: { id: true, code: true, warehouseId: true } });
  const movements = await tx.stockMovement.findMany({ where: { sourceDocument: request.id, clientId: request.clientId, warehouseId, status: 'SHIPPING' }, select: { boxId: true, skuId: true, quantity: true } });
  const net = new Map<string, number>();
  for (const m of movements) { const key = `${m.boxId}:${m.skuId}`; net.set(key, (net.get(key) ?? 0) + m.quantity); }
  const expected = new Map<string, number>();
  const perItem = new Map<string, number>();
  const selections = new Map<string, { id: string; requestItemId: string; skuId: string; boxId: string; quantity: number; createdAt: Date; updatedAt: Date; box: { code: string; warehouseId: string | null } }>();
  for (const pack of packages) {
    const box = boxes.find(b => b.code === pack.packageCode);
    if (!box || pack.clientId !== request.clientId || !pack.items.length) return fail();
    for (const line of pack.items) {
      const item = request.items.find(i => i.id === line.requestItemId);
      if (!item || !line.skuId || item.skuId !== line.skuId || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) return fail();
      const key = `${box.id}:${line.skuId}`;
      expected.set(key, (expected.get(key) ?? 0) + line.quantity);
      perItem.set(item.id, (perItem.get(item.id) ?? 0) + line.quantity);
      const selectionKey = `${item.id}:${box.id}`;
      const prev = selections.get(selectionKey);
      selections.set(selectionKey, { id: selectionKey, requestItemId: item.id, skuId: line.skuId, boxId: box.id, quantity: (prev?.quantity ?? 0) + line.quantity, createdAt: pack.createdAt, updatedAt: pack.updatedAt, box });
    }
  }
  if (request.items.some(i => perItem.get(i.id) !== i.quantity)) return fail();
  if ([...expected].some(([key, qty]) => net.get(key) !== qty) || [...net].some(([key, qty]) => qty !== 0 && expected.get(key) !== qty)) return fail();
  return [...selections.values()];
}

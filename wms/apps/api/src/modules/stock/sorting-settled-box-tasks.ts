import type { Prisma } from '@prisma/client';

// FIX: historical links do not reserve another unit. Read only, inside sorting's transaction.
export async function sortingSettledBoxTaskIds(
  db: Pick<Prisma.TransactionClient, 'fbsTsdAssembly' | 'stockMovement'>,
  source: { id: string; clientId: string; warehouseId: string | null }, skuId: string,
  scanCode: string, parse: (code: string) => { gtin: string; serial: string } | null,
): Promise<string[]> {
  const identity = parse(scanCode);
  if (!identity || !source.warehouseId) return [];
  const tasks = await db.fbsTsdAssembly.findMany({ where: {
    clientId: source.clientId, status: 'RETURN_REQUIRED', completedAt: { not: null },
    AND: [{ OR: [{ skuId }, { sourceSkuId: skuId }] },
      { OR: [{ boxId: source.id }, { reservedBoxId: source.id }] }],
  }, take: 101, orderBy: { id: 'asc' } });
  if (tasks.length > 100) return [];
  const ids: string[] = [];
  for (const task of tasks) {
    const previous = parse(task.kiz ?? '');
    if (task.status !== 'RETURN_REQUIRED' || !task.completedAt || task.clientId !== source.clientId ||
        (task.sourceSkuId ?? task.skuId) !== skuId ||
        task.boxId !== source.id && task.reservedBoxId !== source.id || !previous ||
        previous.gtin === identity.gtin && previous.serial === identity.serial) continue;
    const prefix = `fbs-sticker-pick:${task.id}:`;
    // All task movements, not a filtered subset hiding a return or remaining packing stock.
    const rows = await db.stockMovement.findMany({ where: { idempotencyKey: { startsWith: prefix } } });
    if (rows.length !== 3 || rows.some(row => row.clientId !== source.clientId || row.warehouseId !== source.warehouseId ||
        row.skuId !== skuId || row.boxId !== source.id)) continue;
    const picked = rows.filter(row => row.type === 'PICK' && row.status === 'AVAILABLE' && row.quantity === -1 && row.idempotencyKey?.endsWith(':out'));
    const packed = rows.filter(row => row.type === 'PICK' && row.status === 'PACKING' && row.quantity === 1 && row.idempotencyKey === `${prefix}in`);
    const shipped = rows.filter(row => row.type === 'SHIP' && row.status === 'PACKING' && row.quantity === -1 && row.idempotencyKey?.startsWith(`${prefix}marketplace-complete:`));
    if (picked.length === 1 && packed.length === 1 && shipped.length === 1) ids.push(task.id);
  }
  return ids;
}

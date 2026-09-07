import { Prisma, StockStatus } from '@prisma/client';

type ReceiptReader = Pick<Prisma.TransactionClient, 'stockBalance' | 'clientRequestItem' | 'fbsTsdAssembly'>;

// FIX: diagnostic only; never change a reservation, route, task, KIZ or stock.
export async function collectedFbsBoxMessage(
  db: ReceiptReader,
  input: { requestId: string; clientId: string; warehouseId: string; boxId: string },
): Promise<string | null> {
  if (process.env.WMS_FBS_COLLECTED_SKU_MESSAGE_ENABLED !== 'true') return null;
  const balances = await db.stockBalance.findMany({
    where: { clientId: input.clientId, warehouseId: input.warehouseId, boxId: input.boxId,
      status: StockStatus.AVAILABLE, quantity: { gt: 0 } },
    select: { skuId: true },
  });
  const skuIds = [...new Set(balances.map(row => row.skuId))];
  if (skuIds.length === 0) return null; // No evidence of what an empty box contained.
  const [items, tasks] = await Promise.all([
    db.clientRequestItem.findMany({
      where: { requestId: input.requestId,
        request: { clientId: input.clientId, warehouseId: input.warehouseId },
        skuId: { in: skuIds }, quantity: { gt: 0 } },
      select: { id: true, skuId: true, quantity: true },
    }),
    db.fbsTsdAssembly.findMany({
      where: { requestId: input.requestId, clientId: input.clientId },
      select: { requestItemId: true, skuId: true, sourceSkuId: true,
        status: true, completedAt: true, itemCount: true },
    }),
  ]);
  // FIX: exact SKU/size and current request item IDs, not article or old route hints.
  const relevant = items.filter(item => item.skuId && skuIds.includes(item.skuId));
  if (relevant.length === 0) return null;
  // Relabeling can use this SKU for another target item: keep the existing response.
  if (tasks.some(task => task.sourceSkuId && skuIds.includes(task.sourceSkuId))) return null;
  for (const item of relevant) {
    const completed = tasks
      .filter(task => task.requestItemId === item.id && task.skuId === item.skuId &&
        task.status === 'COMPLETED' && task.completedAt)
      .reduce((sum, task) => sum + task.itemCount, 0);
    // An over-count is inconsistent too; do not present it as verified completion.
    if (completed !== item.quantity) return null;
  }
  const quantity = relevant.reduce((sum, item) => sum + item.quantity, 0);
  const product = new Set(relevant.map(item => item.skuId)).size === 1 ? 'этого товара' : 'этих товаров';
  return `Нужное количество ${product} уже собрано по заявке (${quantity} из ${quantity} шт.). ` +
    'Больше брать из этого короба не нужно. Можно отсканировать другой короб или паллетсорт с ещё нужным товаром.';
}


import type { FbsWbAccountingView } from './api';

export type WbAccountingOrder = FbsWbAccountingView['candidates'][number];
export type WbAccountingResult = { id: string; orderId: string; accounted: boolean; error?: string };
export type WbAccountingBatchHandler = (
  orders: WbAccountingOrder[], comment: string, onProgress: (completed: number, total: number) => void,
) => Promise<WbAccountingResult[]>;

// FIX: each order uses the existing idempotent endpoint once; one rejection preserves other results.
export async function runWbAccountingBatch(
  orders: WbAccountingOrder[], comment: string,
  account: (order: WbAccountingOrder, comment: string) => Promise<{ accounted: boolean; assemblyId: string; orderId: string }>,
  onProgress?: (completed: number, total: number) => void,
): Promise<WbAccountingResult[]> {
  const note = comment.trim();
  if (note.length < 3 || note.length > 1000) throw new Error('Укажите комментарий менеджера (3–1000 символов).');
  const unique = [...new Map(orders.map(order => [order.id, order])).values()];
  const results: WbAccountingResult[] = [];
  for (const order of unique) {
    try {
      const response = await account(order, note);
      if (!response.accounted || response.assemblyId !== order.id || response.orderId !== order.orderId) {
        throw new Error('Сервер не подтвердил результат для этого заказа. Обновите заявку перед повторной проверкой.');
      }
      results.push({ id: order.id, orderId: order.orderId, accounted: true });
    } catch (error) {
      results.push({ id: order.id, orderId: order.orderId, accounted: false,
        error: error instanceof Error ? error.message : 'Не удалось подтвердить результат. Обновите заявку.' });
    }
    onProgress?.(results.length, unique.length);
  }
  return results;
}

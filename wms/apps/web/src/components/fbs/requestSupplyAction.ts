import type { ClientRequestSummary, FbsOrderSummary } from '../../lib/api';

export type RequestSupplyAction = 'deliver' | 'download' | 'print';
export type RequestSupplyTarget = { request: ClientRequestSummary; action: RequestSupplyAction };

export function requestSupplyOrders(target: RequestSupplyTarget, orders: FbsOrderSummary[]) {
  const { request, action } = target;
  const linked = orders.filter(order => order.request?.id === request.id && order.marketplace === 'WILDBERRIES');
  const expected = request.fbsCompletion?.totalOrders;
  if (!linked.length || (expected && linked.length !== expected)) {
    throw new Error('Не удалось загрузить полный состав заявки WB.');
  }
  if (action !== 'deliver') return linked;

  if (!request.fbsCompletion?.completed ||
      linked.some(order => !order.supplyId || order.supplierStatus !== 'confirm')) {
    throw new Error('Для передачи все заказы заявки должны быть собраны и готовы к отправке в WB.');
  }
  const supplyKey = (order: FbsOrderSummary) => JSON.stringify([order.connectionId, order.supplyId]);
  const supplies = new Set(linked.map(supplyKey));
  if (orders.some(order => order.marketplace === 'WILDBERRIES' &&
      supplies.has(supplyKey(order)) && order.request?.id !== request.id)) {
    throw new Error('В поставку WB входят заказы из другой заявки. Проверьте состав поставки.');
  }
  return linked;
}

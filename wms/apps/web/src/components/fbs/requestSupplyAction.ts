import type { ClientRequestSummary, FbsOrderSummary } from '../../lib/api';

export type RequestSupplyAction = 'deliver' | 'download' | 'print' | 'cargo';
export type RequestSupplyTarget = { request: ClientRequestSummary; action: RequestSupplyAction };

export function requestSupplyOrders(target: RequestSupplyTarget, orders: FbsOrderSummary[]) {
  const { request, action } = target;
  // FIX: the client snapshot contains every marketplace; select the exact request first.
  const linked = orders.filter(order => order.request?.id === request.id);
  const expected = request.fbsCompletion?.totalOrders;
  if (!linked.length || (expected && linked.length !== expected)) {
    throw new Error('Не удалось загрузить полный состав заявки FBS.');
  }
  if (linked.some(order => !['WILDBERRIES', 'OZON'].includes(order.marketplace))) {
    throw new Error('Печать стикеров доступна для заявок WB и Ozon.');
  }
  if (action !== 'deliver') return linked;
  if (linked.some(order => order.marketplace !== 'WILDBERRIES')) {
    throw new Error('Эта передача доступна только для WB.');
  }

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

// FIX: a client with only shipped/archived orders remains selected.
export function retainFbsClient(current:string, active:{client:{id:string}}[], explicit='') {
  return explicit || current || active[0]?.client.id || '';
}
// FIX: label retrieval must include persisted shipped orders even while WMS is IN_WORK.
export function requestSupplyNeedsArchive(target:RequestSupplyTarget) {
  return target.action !== 'deliver' || target.request.status === 'DONE';
}
// FIX: request navigation carries its client instead of reusing another screen's client.
export function rememberFbsRequestClient(userId:string,clientId?:string) {
  if(!clientId?.trim())return;
  const storageKey=`logoff-wms:last-client:${userId}`;
  window.localStorage.setItem(storageKey,clientId);
  window.dispatchEvent(new CustomEvent('logoff-wms:last-client-change',{detail:{storageKey,clientId}}));
}

// FIX: marketplace preparation is not handover; retain raw category for operational action guards.
export function fbsDisplayCategory(order:Pick<FbsOrderSummary,'category'|'marketplace'|'supplierStatus'|'wbStatus'|'request'>) {
  if(order.marketplace==='WILDBERRIES' && order.category==='shipped' && order.supplierStatus==='complete' && order.wbStatus==='waiting' && order.request?.status!=='DONE')return 'active';
  return order.category;
}

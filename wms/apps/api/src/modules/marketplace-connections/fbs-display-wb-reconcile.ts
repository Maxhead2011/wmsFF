type Order = {
  id: string;
  connectionId: string;
  marketplace: string;
  category: string;
  supplierStatus: string;
  wbStatus: string;
  statusLabel: string;
};
type Status = { id: number; supplierStatus: string; wbStatus: string };
type Response<T extends Order> = { orders: T[]; counts: Record<string, number> };

// FIX: /orders/new omits handed-over orders. Reconcile missing active rows before
// publishing a new display snapshot, using cabinet-scoped official WB statuses.
export async function reconcileWbDisplay<T extends Order, R extends Response<T>>(
  previous: R | undefined,
  refreshed: R,
  readStatuses: (connectionId: string, ids: number[]) => Promise<Status[]>,
  category: (supplier: string, wb: string) => string,
  label: (supplier: string, wb: string) => string,
): Promise<R> {
  if (!previous) return refreshed;
  const key = (order: Order) => `${order.connectionId}:${order.id}`;
  const currentKeys = new Set(refreshed.orders.map(key));
  const missing = previous.orders.filter(order => !currentKeys.has(key(order)));
  const groups = new Map<string, T[]>();
  for (const order of missing) {
    if (order.marketplace !== 'WILDBERRIES' || order.category !== 'active') continue;
    const group = groups.get(order.connectionId) ?? [];
    group.push(order);
    groups.set(order.connectionId, group);
  }
  const replacements = new Map<string, T>();
  for (const [connectionId, orders] of groups) {
    for (let offset = 0; offset < orders.length; offset += 1000) {
      const batch = orders.slice(offset, offset + 1000);
      const ids = batch.map(order => Number(order.id));
      if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
        throw new Error('Некорректный номер заказа при обновлении статусов WB.');
      }
      const statuses = new Map((await readStatuses(connectionId, ids)).map(status => [String(status.id), status]));
      for (const order of batch) {
        const status = statuses.get(order.id);
        if (!status?.supplierStatus || !status.wbStatus) {
          throw new Error(`WB не вернул статус заказа ${order.id}. Повторите обновление.`);
        }
        replacements.set(key(order), {
          ...order,
          supplierStatus: status.supplierStatus,
          wbStatus: status.wbStatus,
          category: category(status.supplierStatus, status.wbStatus),
          statusLabel: label(status.supplierStatus, status.wbStatus),
        });
      }
    }
  }
  const orders = [...refreshed.orders, ...missing.map(order => replacements.get(key(order)) ?? order)];
  return {
    ...refreshed,
    orders,
    counts: {
      active: orders.filter(order => order.category === 'active').length,
      shipped: orders.filter(order => order.category === 'shipped').length,
      cancelled: orders.filter(order => order.category === 'cancelled').length,
      archive: orders.filter(order => order.category === 'archive').length,
      all: orders.length,
    },
  };
}

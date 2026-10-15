// FIX: opt-in for our WMS; other installations retain their monitoring policy.
export const fbsMonitorRoutingEnabled = () => process.env.WMS_FBS_MONITOR_ROUTING_ENABLED === 'true';

type Connection = { id: string; fbsWarehouseId?: string | null; fbsExecutionWarehouseId?: string | null; fbsAutoRouteNewWarehouses?: boolean };
type Route = { connectionId: string; marketplaceWarehouseId: string; mode: string; executionWarehouseId?: string | null };

export function fbsMonitorRoute(connection: Connection, warehouseId: string | null, routes: Route[]) {
  const id = warehouseId || connection.fbsWarehouseId;
  const route = routes.find(row => row.connectionId === connection.id && row.marketplaceWarehouseId === id);
  if (!id || route?.mode === 'EXCLUDED') return null;
  if (route?.mode === 'BRANCH') return route.executionWarehouseId || null;
  if (route?.mode === 'CENTRAL' || (!route && connection.fbsAutoRouteNewWarehouses)) {
    return connection.fbsExecutionWarehouseId || null;
  }
  return null;
}

// FIX: a task for another warehouse, or unreserved demand, cannot prove this sale.
export function fbsMonitorReservation(task: { skuId: string | null; itemCount: number; status: string; reservedAt: Date | null; stockWarehouseId?: string | null } | undefined,
  skuId: string, quantity: number, warehouseId: string | null) {
  return Boolean(task && task.skuId === skuId && warehouseId && task.stockWarehouseId === warehouseId &&
    task.reservedAt && ['RESERVED', 'IN_PROGRESS', 'COMPLETED'].includes(task.status) && task.itemCount >= quantity);
}

// FIX: filter before SQL pagination and summaries, including historical excluded events.
export async function fbsMonitorScopeWhere(db: any, clientFilter: unknown) {
  if (!fbsMonitorRoutingEnabled()) return {};
  const connections: Connection[] = await db.clientMarketplaceConnection.findMany({
    where: { clientId: clientFilter, marketplace: 'WILDBERRIES', isActive: true },
    select: { id: true, fbsWarehouseId: true, fbsExecutionWarehouseId: true, fbsAutoRouteNewWarehouses: true },
  });
  const routes: Route[] = await db.fbsWarehouseRoutingRule.findMany({ where: { connectionId: { in: connections.map(c => c.id) } } });
  return { OR: connections.map(c => {
    const own = routes.filter(r => r.connectionId === c.id);
    const allowed = own.filter(r => fbsMonitorRoute(c, r.marketplaceWarehouseId, routes)).map(r => r.marketplaceWarehouseId);
    const forbidden = own.filter(r => !fbsMonitorRoute(c, r.marketplaceWarehouseId, routes)).map(r => r.marketplaceWarehouseId);
    return { connectionId: c.id, marketplaceWarehouseId: c.fbsAutoRouteNewWarehouses && c.fbsExecutionWarehouseId
      ? { notIn: forbidden } : { in: allowed } };
  }) };
}

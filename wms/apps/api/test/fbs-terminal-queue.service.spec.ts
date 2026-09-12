import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRequestsService } from '../src/modules/client-requests/client-requests.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { TsdAssemblyService } from '../src/modules/tsd/tsd-assembly.service';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: ended WB orders remain evidence, not instructions to collect more stock.
function fixture() {
  const request = { id: 'request-490', number: 490, clientId: 'client-1', type: 'OUTBOUND',
    title: 'FBS', status: 'IN_WORK', updatedAt: new Date(), _count: { fbsOrderLinks: 5 },
    fbsEmergencyAssemblyAt: new Date(), client: { id: 'client-1', code: 'CL-1', name: 'Client' } };
  const links = Array.from({ length: 5 }, (_, i) => ({ requestId: request.id, clientId: 'client-1',
    marketplace: 'WILDBERRIES', connectionId: 'wb-1', orderId: `order-${i}`, lastSkuId: `sku-${i}`,
    lastItemCount: 1, syncStatus: i === 2 ? 'RETURN_REQUIRED' : 'ACTIVE', lastSupplyId: 'WB-GI-1',
    lastCategory: i === 2 || i === 4 ? 'cancelled' : i === 3 ? 'archive' : 'active',
    lastSupplierStatus: i > 1 ? 'complete' : 'confirm',
    lastWbStatus: ['waiting', 'waiting', 'canceled_by_client', 'sold', 'defect'][i], request }));
  const tasks = links.map((l, i) => ({ id: `task-${i}`, requestId: request.id, requestItemId: `item-${i}`,
    clientId: l.clientId, marketplace: l.marketplace, connectionId: l.connectionId, orderId: l.orderId,
    skuId: l.lastSkuId, sourceSkuId: null, productName: 'Suit', article: 'Suit', itemCount: 1,
    status: ['COMPLETED', 'WAITING_STOCK', 'RETURN_REQUIRED', 'WAITING_STOCK', 'RESERVED'][i],
    completedAt: i === 0 ? new Date() : null, updatedAt: new Date(), deviceCode: 'TSD-1',
    kiz: i === 2 ? 'physical-mark-keep' : null, barcode: i === 2 ? 'barcode-keep' : null,
    boxCode: null, boxId: null, reservedBoxId: null, reservedBoxCode: null, workerName: null,
    requiresKiz: true, cargoPackingId: null, cargoPacking: null, wbMetaStatus: i === 2 ? 'REJECTED' : 'PENDING' }));
  const rows = tasks.map(t => ({ itemId: t.requestItemId, skuId: t.skuId, name: 'Suit', requestedQuantity: 1, allocations: [] }));
  const db: any = {
    clientRequest: { findMany: vi.fn(async () => [request]), findUnique: vi.fn(async () => request) },
    fbsOrderRequestLink: { findMany: vi.fn(async () => links), findUnique: vi.fn(async () => links[2]) },
    fbsTsdAssembly: { findMany: vi.fn(async () => tasks), findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => tasks[2]), update: vi.fn() },
    sku: { findMany: vi.fn(async () => []) }, auditLog: { findMany: vi.fn(async () => []) },
    client: { findMany: vi.fn(async () => []) },
    stockBalance: { findMany: vi.fn(async () => []), update: vi.fn() },
  };
  const user: any = { id: 'admin', name: 'Admin', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'],
    clientScopeMode: 'ALL', clientIds: [], writableClientIds: [], isDemo: false };
  const list = new ClientRequestsService(db, new ClientScopeService(), {} as never);
  const detail: any = new TsdAssemblyService(db, {} as never, {} as never, {} as never);
  const routes: any = new MarketplaceConnectionsService(db, new ClientScopeService());
  vi.spyOn(routes, 'fbsTsdReservationRowsBySku').mockResolvedValue(new Map());
  return { request, links, tasks, rows, db, user, list, detail, routes };
}
afterEach(() => vi.unstubAllEnvs());
describe('our WMS terminal-order queue isolation', () => {
  // TEST: a manager-accounted WB order is evidence, not another physical collection.
  it('keeps WB-accounted orders in a separate group and out of collection, packing and request demand', async () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    vi.stubEnv('WMS_FBS_NO_STOCK_TRANSFER_ENABLED', 'true');
    vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED', 'true');
    const f = fixture();
    f.db.fbsAssemblyAttemptHistory = { findMany: vi.fn(async () => []) };
    f.db.fbsReshipmentRun = { findMany: vi.fn(async () => []) };
    f.links[1].syncStatus = 'WB_ACCOUNTED'; f.links[1].lastSupplierStatus = 'complete'; f.links[1].lastWbStatus = 'sorted';
    f.tasks[1].status = 'WB_ACCOUNTED';
    const before = structuredClone(f.tasks);
    const result = await f.detail.loadFbsAssemblyFacts(f.request.id, f.rows);
    expect(result.notCollected.pendingOrderIds).not.toContain('order-1');
    expect(result.wmsBoxes.notPacked.map(row => row.orderId)).not.toContain('order-1');
    expect(result.wbAccounting.accounted).toEqual([expect.objectContaining({ orderId: 'order-1' })]);
    expect(result.rows.map(row => row.orderId)).not.toContain('order-1');
    expect(result.completedOrders).toBe(1);
    expect((await f.list.list({}, f.user))[0].fbsCompletion).toMatchObject({ totalOrders: 1, completedOrders: 1 });
    expect((await f.routes.getFbsRequestRoute(f.request.id, f.user)).items.map(row => row.orderId)).not.toContain('order-1');
    expect(f.tasks).toEqual(before); expect(f.db.stockBalance.update).not.toHaveBeenCalled();
  });

  // TEST: an acknowledged deferred unit stays visible for receipt, not for repeated collection.
  it.each(['true', 'false'])('shows deferred manager returns with KIZ with terminal filter %s', async terminalFilter => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', terminalFilter);
    vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'true');
    const f = fixture(); f.links[2].syncStatus = 'MANAGER_CONFIRMED_RETURN';
    const result = await f.detail.loadFbsAssemblyFacts(f.request.id, f.rows);
    expect(result.returnRequired.rows).toEqual([expect.objectContaining({ id: 'task-2',
      managerDisposition: 'AWAIT_RETURN_RECEIPT', requiresReturnReceipt: true, kiz: 'physical-mark-keep' })]);
    expect(result.notCollected.pendingOrderIds).not.toContain('order-2');
    expect(f.db.fbsOrderRequestLink.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ syncStatus: { in: expect.arrayContaining(['MANAGER_CONFIRMED_RETURN', 'MANAGER_CONFIRMED_SHIPMENT']) } }),
    }));
    if (terminalFilter === 'false') expect(f.db.fbsOrderRequestLink.findMany.mock.calls[0][0].where.OR)
      .toContainEqual({ syncStatus: { in: ['MANAGER_CONFIRMED_SHIPMENT', 'MANAGER_CONFIRMED_RETURN'] } });
  });
  it('retains manager-confirmed labelled shipment in completed facts without requiring return', async () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'true');
    const f = fixture(); f.links[2].syncStatus = 'MANAGER_CONFIRMED_SHIPMENT'; f.tasks[2].status = 'COMPLETED';
    const result = await f.detail.loadFbsAssemblyFacts(f.request.id, f.rows);
    expect(result.rows.find(row => row.id === 'task-2')).toMatchObject({ status: 'COMPLETED',
      managerDisposition: 'SHIP_WITH_WB_LABEL', kiz: 'physical-mark-keep' });
    expect(result.returnRequired.rows).toEqual([]);
    expect(f.db.stockBalance.update).not.toHaveBeenCalled();
  });
  it('excludes terminal orders from request counters without altering history', async () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    const f = fixture(); const before = structuredClone(f.tasks);
    const result = await f.list.list({}, f.user);
    expect(result[0].fbsCompletion).toMatchObject({ totalOrders: 2, completedOrders: 1, percent: 50 });
    expect(f.tasks).toEqual(before);
  });
  it('derives remaining units from eligible orders, not obsolete saved item quantities', async () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    const f = fixture(); const before = structuredClone(f.tasks);
    const result = await f.detail.loadFbsAssemblyFacts(f.request.id, f.rows);
    expect(result.notCollected).toMatchObject({ remainingOrders: 1, remainingUnits: 1, remainingPositions: 1, pendingOrderIds: ['order-1'] });
    expect(result.rows).toHaveLength(5);
    expect(result.notForAssembly.find(row => row.orderId === 'order-2')).toMatchObject({ kiz: 'physical-mark-keep', productBarcode: 'barcode-keep' });
    expect(result.returnRequired.rows).toEqual([]);
    expect(f.tasks).toEqual(before);
    expect(f.db.stockBalance.update).not.toHaveBeenCalled();
  });
  it('does not direct the picker to boxes for canceled/sold/defective orders', async () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    const f = fixture();
    const result = await f.routes.getFbsRequestRoute(f.request.id, f.user);
    expect(result.items.map(r => r.orderId)).toEqual(['order-0', 'order-1']);
    expect(result.summary).toMatchObject({ total: 2, gathered: 1, unavailable: 1 });
  });
  it('retains completed physical facts after WB cancellation', async () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    const f = fixture(); f.links[0].lastWbStatus = 'canceled_by_client'; f.links[0].lastCategory = 'cancelled';
    expect((await f.list.list({}, f.user))[0].fbsCompletion).toMatchObject({ totalOrders: 2, completedOrders: 1 });
    const result = await f.detail.loadFbsAssemblyFacts(f.request.id, f.rows);
    expect(result.completedOrders).toBe(1); expect(result.notCollected.remainingOrders).toBe(1);
  });
  it('keeps complete/waiting available for explicitly enabled emergency assembly', async () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    const f = fixture(); f.links[1].lastSupplierStatus = 'complete'; f.links[1].lastCategory = 'shipped';
    expect((await f.detail.loadFbsAssemblyFacts(f.request.id, f.rows)).notCollected.pendingOrderIds).toEqual(['order-1']);
  });
  it('does not change the sold WMS when the feature is disabled', async () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'false');
    const f = fixture();
    expect((await f.routes.getFbsRequestRoute(f.request.id, f.user)).items).toHaveLength(5);
    expect((await f.list.list({}, f.user))[0].fbsCompletion.totalOrders).toBe(5);
  });
  it('shows zero remaining units for terminal-only requests without clearing their evidence', async () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    const f = fixture();
    f.tasks[0].status = 'WAITING_STOCK';
    f.links[0].lastWbStatus = 'sold'; f.links[1].lastWbStatus = 'sold';
    const before = structuredClone({ tasks: f.tasks, links: f.links });
    expect((await f.list.list({}, f.user))[0].fbsCompletion).toMatchObject({ totalOrders: 0, completedOrders: 0 });
    const result = await f.detail.loadFbsAssemblyFacts(f.request.id, f.rows);
    expect(result.notCollected).toMatchObject({ remainingOrders: 0, remainingUnits: 0, rows: [] });
    expect(result.rows).toHaveLength(5);
    expect({ tasks: f.tasks, links: f.links }).toEqual(before);
  });
  it('returns zero demand for terminal links even when collection never started', async () => {
    // TEST: null would fall back to the obsolete saved collection instructions.
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    const f = fixture(); f.tasks.splice(0);
    f.links.forEach(link => { link.lastWbStatus = 'sold'; });
    const result = await f.detail.loadFbsAssemblyFacts(f.request.id, f.rows);
    expect(result.notCollected.remainingUnits).toBe(0);
    expect(result.notForAssembly).toHaveLength(5);
  });
  it('counts multi-unit eligible demand, not the old canceled quantity', async () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    const f = fixture(); f.links[1].lastItemCount = 3; f.tasks[1].itemCount = 3;
    f.rows[1].requestedQuantity = 8;
    const result = await f.detail.loadFbsAssemblyFacts(f.request.id, f.rows);
    expect(result.notCollected.remainingOrders).toBe(1);
    expect(result.notCollected.remainingUnits).toBe(3);
  });
  it('TSD emergency selector contains only the one order that still needs collection', async () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    const f = fixture();
    const result = await f.routes.listFbsTsdRequests('TSD-1', f.user);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({ totalOrders: 1, completedOrders: 1 });
  });
  it('does not reintroduce a terminal request through a saved open task', async () => {
    // TEST: keep physical evidence, but do not advertise the stale task for assembly.
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    const f = fixture(); f.links[1].lastWbStatus = 'sold'; f.tasks[2].status = 'IN_PROGRESS';
    f.db.fbsTsdAssembly.findFirst.mockResolvedValue(f.tasks[2]);
    const result = await f.routes.listFbsTsdRequests('TSD-1', f.user);
    expect(result.requests).toEqual([]);
    expect(result.message).toContain('не требуется собирать');
    expect(f.db.fbsTsdAssembly.update).not.toHaveBeenCalled();
  });
  it('TSD does not offer an emergency request with only terminal orders left', async () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    const f = fixture(); f.links[1].lastWbStatus = 'sold';
    expect((await f.routes.listFbsTsdRequests('TSD-1', f.user)).requests).toEqual([]);
  });
  it.each(['scanFbsTsdBarcode', 'scanFbsTsdKiz', 'completeFbsTsdAssembly'])('blocks %s for an already-open terminal order without resetting its scans', async method => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    const f = fixture(); f.user.deviceCode = 'TSD-1';
    Object.assign(f.tasks[2], { workerUserId: f.user.id, deviceCode: 'TSD-1', status: 'IN_PROGRESS' });
    const before = structuredClone(f.tasks);
    const promise = method === 'completeFbsTsdAssembly'
      ? f.routes[method]('task-2', f.user)
      : f.routes[method]('task-2', { barcode: 'barcode', kiz: 'mark' }, f.user);
    await expect(promise).rejects.toThrow('не требуется собирать');
    expect(f.tasks).toEqual(before); expect(f.db.fbsTsdAssembly.update).not.toHaveBeenCalled();
  });
});

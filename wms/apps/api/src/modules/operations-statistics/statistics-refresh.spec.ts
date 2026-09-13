import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../marketplace-connections/marketplace-connections.service', () => ({ marketplaceJson: vi.fn() }));
import { marketplaceJson } from '../marketplace-connections/marketplace-connections.service';
import { StatisticsRefreshService } from './statistics-refresh.service';
import type { AuthUser } from '../auth/auth.types';
const request = vi.mocked(marketplaceJson);
const connection = { id: 'c', clientId: 'client', marketplace: 'WILDBERRIES', accountName: 'WB', client: { name: 'Client' },
  fbsExecutionWarehouseId: 'msk', fbsWarehouseId: 'seller', fbsAutoRouteNewWarehouses: false, fbsWarehouseRoutes: [] };
const scope = { branches: [{ id: 'msk' }], connections: [connection], period: { start: new Date('2026-09-01'), end: new Date('2026-09-03') } };
const order = { id: 123, warehouseId: 'seller', deliveryType: 'fbs', supplyId: 'WB-GI-1', createdAt: '2026-09-01T00:00:00Z' };
const user = { id: 'admin', roleCodes: ['ADMIN'], permissionCodes: ['stock:read'], clientScopeMode: 'ALL', clientIds: [] } as unknown as AuthUser;
function setup() {
  const db = { clientMarketplaceConnection: { findFirst: vi.fn().mockResolvedValue({ apiKey: 'test-key' }) },
    fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue([{ orderId: '123' }]) },
    operationsStatisticsFact: { upsert: vi.fn().mockResolvedValue({}) } };
  const statistics = { scope: vi.fn().mockResolvedValue(scope) };
  const service = new StatisticsRefreshService(db as never, statistics as never);
  const job = { id: 'job', status: 'running', errors: [] as string[], ordersUpdated: 0, connectionsDone: 0, startedAt: new Date().toISOString(), finishedAt: null };
  const run = () => (service as unknown as { run: (s: unknown, j: unknown) => Promise<void> }).run(scope, job);
  return { db, service, statistics, job, run };
}
beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async url => {
    if (url.endsWith('/reshipment')) return { orders: [] };
    if (url.includes('/orders?')) return { orders: [order], next: 0 };
    if (url.endsWith('/orders/status')) return { orders: [{ id: 123, supplierStatus: 'complete', wbStatus: 'waiting' }] };
    return { id: 'WB-GI-1', done: true, closedAt: '2026-09-01T01:00:00Z', scanDt: '2026-09-01T14:00:00Z' };
  });
});
describe('report refresh isolation // TEST', () => {
  it('consumes subsequent pages and upserts the same identity on retry, without double counting duplicate rows', async () => {
    request.mockImplementation(async url => {
      if (url.endsWith('/reshipment')) return { orders: [] };
      if (url.includes('/orders?')) return url.includes('next=0') ? { orders: [order, order], next: 123 } : { orders: [], next: 0 };
      if (url.endsWith('/orders/status')) return { orders: [{ id: 123, wbStatus: 'sorted' }] };
      return { id: 'WB-GI-1', scanDt: '2026-09-01T14:00:00Z' };
    });
    const { run, job, db } = setup(); await run();
    expect(job.ordersUpdated).toBe(1);
    expect(request.mock.calls.some(([url]) => url.includes('next=123'))).toBe(true);
    await run();
    expect(db.operationsStatisticsFact.upsert.mock.calls[0][0].where).toEqual(db.operationsStatisticsFact.upsert.mock.calls[1][0].where);
  });
  it('never reports complete when WB pagination loops', async () => {
    request.mockImplementation(async url => {
      if (url.endsWith('/reshipment')) return { orders: [] };
      if (url.includes('/orders?')) return { orders: [order], next: 123 };
      if (url.endsWith('/orders/status')) return { orders: [{ id: 123, wbStatus: 'sorted' }] };
      return { id: 'WB-GI-1', scanDt: null };
    });
    const { run, job } = setup(); await run();
    expect(job.status).toBe('partial'); expect(job.connectionsDone).toBe(0);
  });
  it('splits long periods into WB requests of at most 30 days', async () => {
    request.mockImplementation(async url => url.endsWith('/reshipment') ? { orders: [] } : { orders: [], next: 0 });
    const { service, job } = setup();
    await (service as unknown as { run: (s: unknown, j: unknown) => Promise<void> }).run({ ...scope, period: { start: new Date('2026-07-01'), end: new Date('2026-09-01') } }, job);
    const queries = request.mock.calls.filter(([url]) => url.includes('/orders?')).map(([url]) => new URL(url).searchParams);
    expect(queries).toHaveLength(3);
    expect(queries.every(q => Number(q.get('dateTo')) - Number(q.get('dateFrom')) < 30 * 86400)).toBe(true);
  });
  it('saves marketplace creation and scanDt, with independent waiting status, and only writes reporting facts', async () => {
    const { db, run, job } = setup(); await run();
    expect(db.operationsStatisticsFact.upsert).toHaveBeenCalledOnce();
    expect(db.operationsStatisticsFact.upsert.mock.calls[0][0]).toMatchObject({ create: { orderPlacedAt: new Date(order.createdAt),
      supplyScannedAt: new Date('2026-09-01T14:00:00Z'), wbStatus: 'waiting', requiresReshipment: false }, update: { supplyId: 'WB-GI-1' } });
    expect(job.status).toBe('complete');
    expect(request.mock.calls.every(([url, init]) => init.method === 'GET' || url.endsWith('/orders/status'))).toBe(true);
    expect(db.fbsOrderRequestLink.findMany.mock.calls[0][0].where.request).toMatchObject({ clientId: 'client', warehouseId: { in: ['msk'] } });
  });
  it('does not use closedAt when scanDt is absent, even for a closed supply', async () => {
    request.mockImplementationOnce(async () => ({ orders: [] })).mockImplementationOnce(async () => ({ orders: [order], next: 0 }))
      .mockImplementationOnce(async () => ({ orders: [{ id: 123, wbStatus: 'sorted' }] }))
      .mockImplementationOnce(async () => ({ id: 'WB-GI-1', done: true, closedAt: '2026-09-01T01:00:00Z', scanDt: null }));
    const { db, run } = setup(); await run();
    expect(db.operationsStatisticsFact.upsert.mock.calls[0][0].create.supplyScannedAt).toBeNull();
  });
  it('ignores external warehouses and orders not linked to an authorized WMS request', async () => {
    const { db, run } = setup(); db.fbsOrderRequestLink.findMany.mockResolvedValue([]); await run();
    expect(db.operationsStatisticsFact.upsert).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([url]) => url.includes('/supplies/WB-GI-'))).toBe(false);
  });
  it('does not turn a failed reshipment lookup into a false all-clear', async () => {
    request.mockRejectedValue(new Error('upstream secret must not leak'));
    const { db, run, job } = setup(); await run();
    expect(job.status).toBe('failed'); expect(JSON.stringify(job)).not.toContain('secret');
    expect(db.operationsStatisticsFact.upsert).not.toHaveBeenCalled();
  });
  it('clears the scan after a failed supply lookup and marks the refresh incomplete', async () => {
    request.mockImplementationOnce(async () => ({ orders: [] })).mockImplementationOnce(async () => ({ orders: [order], next: 0 }))
      .mockImplementationOnce(async () => ({ orders: [{ id: 123, wbStatus: 'sorted' }] })).mockRejectedValueOnce(new Error('HTTP 429'));
    const { db, run, job } = setup(); await run();
    expect(job.status).toBe('partial');
    expect(db.operationsStatisticsFact.upsert.mock.calls[0][0].update).toMatchObject({ supplyScannedAt: null, issue: 'SUPPLY_SCAN_UNAVAILABLE' });
  });
  it('rejects unauthorized scope before any WB request and hides jobs from other users', async () => {
    const { service, statistics } = setup(); statistics.scope.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(service.start({ dateFrom: '2026-09-01', dateTo: '2026-09-02' }, user)).rejects.toThrow('Forbidden');
    expect(request).not.toHaveBeenCalled();
    const job = await service.start({ dateFrom: '2026-09-01', dateTo: '2026-09-02' }, user);
    expect(() => service.progress(job.id, { ...user, id: 'other' })).toThrow('недоступно');
    await expect(service.start({ dateFrom: '2026-09-01', dateTo: '2026-09-02' }, user)).rejects.toThrow('недавно');
  });
});

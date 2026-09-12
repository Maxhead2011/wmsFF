import { describe, expect, it, vi } from 'vitest';
import { OperationsStatisticsService, observation, statisticsPeriod } from './operations-statistics.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';

const user = { roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], isDemo: false, clientScopeMode: 'ALL', warehouseIds: [] } as unknown as AuthUser;
const filter = { dateFrom: '2026-09-01', dateTo: '2026-09-03', clientId: 'client' };
const makeLink = (id: string, patch: Record<string, unknown> = {}) => ({ id, marketplace: 'WILDBERRIES', connectionId: 'c1', orderId: id,
  clientId: 'client', orderPlacedAt: new Date('2026-09-01T00:00:00Z'), handedOverAt: null,
  sellerWarehouseId: 'seller1', sellerWarehouseName: 'WB Москва', lastCategory: 'shipped', lastSeenAt: new Date('2026-09-03T00:00:00Z'),
  createdAt: new Date('2026-09-01T02:00:00Z'), request: { warehouseId: 'msk' }, ...patch });
function setup(links = [makeLink('1')]) {
  const db = {
    warehouse: { findMany: vi.fn().mockResolvedValue([{ id: 'msk', name: 'Москва' }, { id: 'ng', name: 'Ногинск' }]) },
    clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue([{ id: 'c1', clientId: 'client', marketplace: 'WILDBERRIES', accountName: 'Кабинет',
      client: { name: 'Лукин' }, fbsWarehouseId: 'seller1', fbsWarehouseName: 'WB Москва', fbsExecutionWarehouseId: 'msk', fbsWarehouseRoutes: [] }]) },
    fbsSupplyPlan: { findMany: vi.fn().mockResolvedValue([{ id: 's1', connectionId: 'c1', orderIds: ['1', '2'], sentToWbAt: new Date('2026-09-01T14:00:00Z'), marketplaceWarehouseId: 'seller1', marketplaceWarehouseName: 'WB Москва' }]) },
    fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue(links) },
    fbsStockMonitorEvent: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { db, service: new OperationsStatisticsService(db as never, new ClientScopeService()) };
}
describe('operations statistics // TEST', () => {
  it('groups by branch then seller and preserves zero branches; 14h is yellow', async () => {
    const { service } = setup(); const r = await service.report(filter, user);
    expect(r.summary.buckets[1]).toMatchObject({ count: 1, percent: 100 });
    expect(r.branches[0].warehouses[0].summary.total).toBe(1);
    expect(r.branches[1].summary.total).toBe(0);
  });
  it('excludes cancellations; delivered orders without a delivery timestamp are unknown, not pending', async () => {
    const { service } = setup([makeLink('1', { lastCategory: 'cancelled' }), makeLink('3')]);
    const r = await service.report(filter, user);
    expect(r.summary).toMatchObject({ total: 2, timedShipped: 0, cancelled: 1, unknown: 1, pending: 0 });
  });
  it('uses historical SALE source when available, never the link import time', async () => {
    const { service, db } = setup([makeLink('1', { orderPlacedAt: null }), makeLink('3', { orderPlacedAt: null })]);
    db.fbsStockMonitorEvent.findMany.mockResolvedValue([{ marketplace: 'WILDBERRIES', connectionId: 'c1', orderId: '1', saleAt: new Date('2026-09-01T00:00:00Z') }] as never);
    const r = await service.report(filter, user);
    expect(r.summary.timedShipped).toBe(1); expect(r.missingOrderDate).toBe(1);
  });
  it('does not mix same order numbers in different connections', async () => {
    const { service } = setup([makeLink('1', { connectionId: 'foreign' })]);
    expect((await service.report(filter, user)).summary.total).toBe(0);
  });
  it('filters by order time rather than delivery date', async () => {
    const { service } = setup([makeLink('1', { orderPlacedAt: new Date('2026-08-31T20:59:59Z') })]);
    expect((await service.report(filter, user)).summary.total).toBe(0);
  });
  it('scopes non-admin queries to readable branches; does not require write grants for a report', async () => {
    const { service, db } = setup();
    await service.report(filter, { ...user, roleCodes: ['MANAGER'], permissionCodes: ['stock:read'], warehouseIds: ['msk'] });
    expect(db.warehouse.findMany.mock.calls[0][0].where.id).toEqual({ in: ['msk'] });
    expect(db.fbsOrderRequestLink.findMany.mock.calls[0][0].where.request.clientId).toBe('client');
  });
  it('rejects inaccessible clients and explicit branches before querying data', async () => {
    const { service, db } = setup();
    const limited = { ...user, roleCodes: ['MANAGER'], permissionCodes: ['stock:read'], clientScopeMode: 'LIMITED' as const, clientIds: [], warehouseIds: ['msk'] };
    await expect(service.report(filter, limited)).rejects.toThrow();
    await expect(service.report({ ...filter, branchId: 'foreign' }, limited)).rejects.toThrow('Филиал недоступен');
    expect(db.warehouse.findMany).not.toHaveBeenCalled();
  });
  it.each([{ roleCodes: ['CLIENT'] }, { isDemo: true }])('rejects client/demo access %j', async patch => {
    await expect(setup().service.report(filter, { ...user, ...patch })).rejects.toThrow('сотрудникам');
  });
  it('reads all pages rather than silently truncating the first 500 orders', async () => {
    const { service, db } = setup();
    db.fbsOrderRequestLink.findMany.mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => makeLink(String(i), { lastCategory: 'active' })))
      .mockResolvedValueOnce([makeLink('last', { lastCategory: 'active' })]);
    expect((await service.report(filter, user)).summary.total).toBe(501);
    expect(db.fbsOrderRequestLink.findMany.mock.calls[1][0].skip).toBe(1);
  });
  it('accepts exact Ozon delivery timestamp; never completedAt or label submission', async () => {
    const { service, db } = setup([makeLink('3', { marketplace: 'OZON', handedOverAt: new Date('2026-09-01T18:00:00Z') })]);
    db.clientMarketplaceConnection.findMany.mockResolvedValue([{ id: 'c1', clientId: 'client', marketplace: 'OZON', accountName: 'Ozon',
      client: { name: 'Лукин' }, fbsWarehouseId: 'seller1', fbsWarehouseName: 'Ozon Москва', fbsExecutionWarehouseId: 'msk', fbsWarehouseRoutes: [] }]);
    db.fbsSupplyPlan.findMany.mockResolvedValue([]);
    expect((await service.report(filter, user)).summary.buckets[2].count).toBe(1);
    expect(observation(new Date('2026-09-02'), new Date('2026-09-01'), 'shipped', new Date('2026-09-03')).state).toBe('unknown');
  });
  it('validates Moscow midnight, invalid dates and maximum period', () => {
    expect(statisticsPeriod('2026-09-01', '2026-09-01').start.toISOString()).toBe('2026-08-31T21:00:00.000Z');
    expect(() => statisticsPeriod('2026-02-30', '2026-03-01')).toThrow();
    expect(() => statisticsPeriod('2026-01-01', '2026-09-01')).toThrow();
    expect(() => statisticsPeriod('2026-09-02', '2026-09-01')).toThrow();
  });
});

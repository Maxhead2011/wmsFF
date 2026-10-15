import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService as SourceService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { FbsStockMonitoringService as SourceMonitor } from '../src/modules/marketplace-connections/fbs-stock-monitoring.service';
const MarketplaceConnectionsService = process.env.MONITOR_PROOF_RUNTIME
  ? createRequire(import.meta.url)(process.env.MONITOR_PROOF_RUNTIME).MarketplaceConnectionsService : SourceService;
import * as sourceRouting from '../src/modules/marketplace-connections/fbs-monitor-routing';
import * as sourceRules from '../src/modules/marketplace-connections/fbs-stock-monitoring.rules';
const runtimeModule = (file: string) => createRequire(import.meta.url)(join(dirname(process.env.MONITOR_PROOF_RUNTIME!), file));
const { fbsMonitorRoute, fbsMonitorScopeWhere } = process.env.MONITOR_PROOF_RUNTIME ? runtimeModule('fbs-monitor-routing.js') : sourceRouting;
const { evaluateFbsStockMonitorWms } = process.env.MONITOR_PROOF_RUNTIME ? runtimeModule('fbs-stock-monitoring.rules.js') : sourceRules;
const Monitor = process.env.MONITOR_PROOF_RUNTIME ? runtimeModule('fbs-stock-monitoring.service.js').FbsStockMonitoringService : SourceMonitor;

afterEach(() => vi.unstubAllEnvs());
function setup(mode = 'CENTRAL', task: any = {}) {
  vi.stubEnv('WMS_FBS_MONITOR_ROUTING_ENABLED', 'true');
  const connection = { id: 'c', clientId: 'client', apiKey: 'test', fbsWarehouseId: 'wb', fbsExecutionWarehouseId: 'moscow', fbsAutoRouteNewWarehouses: false };
  const db: any = {
    clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue([connection]) },
    fbsWarehouseRoutingRule: { findMany: vi.fn().mockResolvedValue([{ connectionId: 'c', marketplaceWarehouseId: 'wb', mode, executionWarehouseId: 'branch' }]) },
    fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([{ id: 'task', connectionId: 'c', orderId: 'order', skuId: 'sku', itemCount: 1, status: 'WAITING_STOCK', reservedAt: null, reservedBoxId: null, stockWarehouseId: mode === 'BRANCH' ? 'branch' : 'moscow', ...task }]) },
  };
  const service: any = new MarketplaceConnectionsService(db, {} as any);
  service.resolveFbsExecutionWarehouseId = vi.fn(async (_client, id) => id);
  service.fetchWildberriesStockAmounts = vi.fn().mockResolvedValue(new Map([[10, 2]]));
  service.calculateFbsStockQuantities = vi.fn().mockResolvedValue(new Map([['sku', { available: 4, reserved: 1, sellable: 3 }]]));
  const event = { eventId: 'event', eventType: 'SALE', connectionId: 'c', clientId: 'client', orderId: 'order', skuId: 'sku', quantity: 1, chrtId: 10, marketplaceWarehouseId: 'wb', executionWarehouseId: 'moscow' };
  return { service, event };
}
describe('routed monitoring proof', () => {
  // TEST: an outstanding demand is not evidence of a physical reservation.
  it('does not confirm WAITING_STOCK', async () => {
    const { service, event } = setup();
    const [result] = await service.probeFbsStockMonitoring([event]);
    expect(result.wmsReservationMatched).toBe(false);
  });
  // TEST: the exact order warehouse overrides the connection default.
  it('uses the BRANCH route', async () => {
    const { service, event } = setup('BRANCH');
    await service.probeFbsStockMonitoring([event]);
    expect(service.calculateFbsStockQuantities).toHaveBeenCalledWith('client', ['sku'], 'branch', 'c');
  });
  // TEST: excluded warehouses must not trigger WB reads or WMS comparisons.
  it('skips EXCLUDED', async () => {
    const { service, event } = setup('EXCLUDED');
    const [result] = await service.probeFbsStockMonitoring([event]);
    expect(service.fetchWildberriesStockAmounts).not.toHaveBeenCalled();
    expect(service.calculateFbsStockQuantities).not.toHaveBeenCalled();
    expect(result.wmsReservationMatched).toBe(false);
    expect(result.wmsError).toBeTruthy();
  });
  it('confirms a complete reservation in the correct branch', async () => {
    const { service, event } = setup('BRANCH', { status: 'RESERVED', reservedAt: new Date(), reservedBoxId: 'box' });
    expect((await service.probeFbsStockMonitoring([event]))[0].wmsReservationMatched).toBe(true);
  });
  it('rejects a reservation from a different branch', async () => {
    const { service, event } = setup('BRANCH', { status: 'RESERVED', reservedAt: new Date(), reservedBoxId: 'box', stockWarehouseId: 'moscow' });
    expect((await service.probeFbsStockMonitoring([event]))[0].wmsReservationMatched).toBe(false);
  });
  it('retains legacy behavior without opt-in', async () => {
    const { service, event } = setup();
    vi.stubEnv('WMS_FBS_MONITOR_ROUTING_ENABLED', 'false');
    expect((await service.probeFbsStockMonitoring([event]))[0].wmsReservationMatched).toBe(true);
  });
  // TEST: another sale's aggregate decrement must not hide this order's missing reservation.
  it('does not substitute an aggregate decrement for an exact reservation', () => {
    expect(evaluateFbsStockMonitorWms({ eventType: 'SALE', quantity: 1, beforeAmount: 10,
      currentAmount: 1, exactOrderMatched: true, exactReservationMatched: false,
      exactReservationRequired: true, nowMs: 100, deadlineMs: 10, attempt: 2, maxAttempts: 2,
    }).status).toBe('ERROR');
  });
  it('does not treat RETURN_REQUIRED as a released reservation', async () => {
    const { service, event } = setup('CENTRAL', { status: 'RETURN_REQUIRED' });
    event.eventType = 'CANCEL';
    expect((await service.probeFbsStockMonitoring([event]))[0].wmsReservationReleased).toBe(false);
  });
  it('rejects an incomplete reservation', async () => {
    const { service, event } = setup('CENTRAL', { status: 'RESERVED', reservedAt: new Date() });
    event.quantity = 2;
    expect((await service.probeFbsStockMonitoring([event]))[0].wmsReservationMatched).toBe(false);
  });
  it('requires reservation evidence even for a RESERVED status', async () => {
    const { service, event } = setup('CENTRAL', { status: 'RESERVED' });
    expect((await service.probeFbsStockMonitoring([event]))[0].wmsReservationMatched).toBe(false);
  });
  it('fails closed for unknown warehouses unless automatic routing is enabled', () => {
    const c = { id: 'c', fbsExecutionWarehouseId: 'moscow' };
    expect(fbsMonitorRoute(c, 'unknown', [])).toBeNull();
    expect(fbsMonitorRoute({ ...c, fbsAutoRouteNewWarehouses: true }, 'unknown', [])).toBe('moscow');
    expect(fbsMonitorRoute({ ...c, fbsAutoRouteNewWarehouses: true }, 'unknown', [{ connectionId: 'c', marketplaceWarehouseId: 'unknown', mode: 'EXCLUDED' }])).toBeNull();
  });
  it('builds a connection-specific SQL scope before pagination', async () => {
    vi.stubEnv('WMS_FBS_MONITOR_ROUTING_ENABLED', 'true');
    const db = { clientMarketplaceConnection: { findMany: async () => [{ id: 'c', fbsExecutionWarehouseId: 'moscow' }] },
      fbsWarehouseRoutingRule: { findMany: async () => [
        { connectionId: 'c', marketplaceWarehouseId: 'ours', mode: 'CENTRAL' },
        { connectionId: 'c', marketplaceWarehouseId: 'excluded', mode: 'EXCLUDED' },
      ] } };
    expect(await fbsMonitorScopeWhere(db, 'client')).toEqual({ OR: [{ connectionId: 'c', marketplaceWarehouseId: { in: ['ours'] } }] });
  });
  // TEST: historical false SUCCESS is re-evaluated when the user refreshes a row.
  it('rechecks stored success and persists the routed warehouse', async () => {
    vi.stubEnv('WMS_FBS_MONITOR_ROUTING_ENABLED', 'true');
    const event = { id: 'event', clientId: 'client', connectionId: 'c', orderId: 'order', skuId: 'sku',
      eventType: 'SALE', quantity: 1, chrtId: 10, marketplaceWarehouseId: 'wb', executionWarehouseId: 'wrong',
      deadlineAt: new Date(0), wbStatus: 'SUCCESS', wmsStatus: 'SUCCESS', wbAttempts: 1, wmsAttempts: 1,
      wmsBeforeAmount: 10, wmsExpectedAfterAmount: 9 };
    const update = vi.fn().mockResolvedValue({});
    const db: any = {
      clientMarketplaceConnection: { findMany: async () => [{ id: 'c', fbsExecutionWarehouseId: 'branch' }] },
      fbsWarehouseRoutingRule: { findMany: async () => [{ connectionId: 'c', marketplaceWarehouseId: 'wb', mode: 'CENTRAL' }] },
      fbsStockMonitorRun: { create: async () => ({ id: 'run' }), update: async () => ({}) },
      fbsStockMonitorEvent: { findMany: async () => [event], updateMany: async () => ({ count: 1 }), update },
      fbsStockMonitorConfig: { findMany: async () => [] },
      fbsStockMonitorHistory: { create: async () => ({}) },
      $transaction: async (rows: any[]) => Promise.all(rows),
    };
    const monitor: any = new Monitor(db, {}, { get: () => undefined }, {});
    monitor.registerProbe(async () => [{ eventId: 'event', executionWarehouseId: 'branch', wbCurrentAmount: 1,
      wbOrderMatched: true, wmsCurrentAmount: 1, wmsSellableAmount: 1, wmsReservedAmount: 0,
      wmsReservationMatched: false, wmsReservationReleased: false, wmsReservationRequired: true }]);
    await monitor.runChecks({ force: true, where: { clientId: 'client' } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ wmsStatus: 'ERROR', executionWarehouseId: 'branch' }) }));
  });
});

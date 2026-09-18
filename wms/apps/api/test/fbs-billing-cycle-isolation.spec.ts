import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => vi.unstubAllEnvs());
const flag = 'WMS_FBS_BILLING_DAILY_TRANSACTIONS';
const order = (id: string, day: string, supplyId = id) => ({ id, marketplace: 'WILDBERRIES', connectionId: 'wb', supplyId, deliveryDate: `${day}T10:00:00Z`, category: 'shipped' });

// TEST: the old whole-history transaction exceeds its budget; daily transactions do not.
it('bounds historical billing transactions without splitting a shipment or a billing day', async () => {
  vi.stubEnv(flag, 'true');
  let elapsed = 0;
  const db: any = { $queryRaw: vi.fn(async () => []), $transaction: vi.fn(async (fn: any) => { elapsed = 0; return fn(db); }) };
  const service: any = new MarketplaceConnectionsService(db, {} as never);
  const groups: string[][] = [];
  const billingTransactions: number[] = [];
  service.ensureFbsProcessingChargesLocked = vi.fn(async (_client: string, orders: any[]) => {
    expect(db.$queryRaw).toHaveBeenCalled();
    elapsed += orders.length * 20000;
    if (elapsed > 60000) throw new Error('Transaction already closed: 60000 ms');
    groups.push(orders.map(o => o.id));
    billingTransactions.push(db.$transaction.mock.calls.length);
    return new Map(orders.map(o => [o.id, { chargeId: o.id }]));
  });
  const orders = [order('a', '2026-09-10', 'same'), order('b', '2026-09-11', 'same'), order('c', '2026-09-10'), order('d', '2026-09-12')];
  expect((await service.ensureFbsProcessingCharges('client', orders)).size).toBe(4);
  expect(groups).toEqual([['a', 'b', 'c'], ['d']]);
  expect(new Set(billingTransactions).size).toBe(2);
  vi.stubEnv(flag, 'false');
  await expect(service.ensureFbsProcessingCharges('client', orders)).rejects.toThrow('60000 ms');
});

function backgroundFixture() {
  const service: any = new MarketplaceConnectionsService({ clientMarketplaceConnection: { findMany: vi.fn(async () => [{ clientId: 'client' }]) } } as never, {} as never);
  const events: string[] = [];
  const billing = { chargeId: 'cached', totalRub: 10 };
  const shipped = { ...order('a', '2026-09-10'), billing };
  service.loadFbsOrders = vi.fn(async (_id, _previous, options) => {
    events.push('orders');
    if (options?.billingMode !== 'skip') throw new Error('Transaction already closed: 60000 ms');
    return { orders: [shipped], counts: {} };
  });
  service.ingestFbsStockMonitoringOrders = vi.fn(async () => undefined);
  service.autoSyncFbsStocksForClient = vi.fn(async () => { events.push('stocks'); });
  service.ensureFbsProcessingCharges = vi.fn(async () => { events.push('billing'); throw new Error('Transaction already closed: 60000 ms'); });
  service.logger = { warn: vi.fn(), log: vi.fn() };
  return { service, events, billing };
}

// TEST: billing failure cannot prevent stock synchronization or erase cached amounts.
it('updates stocks before billing and reports billing failure separately', async () => {
  vi.stubEnv(flag, 'true');
  const { service, events, billing } = backgroundFixture();
  await service.refreshAllFbsClients();
  expect(events).toEqual(['orders', 'stocks', 'billing']);
  expect(service.fbsOrdersCache.get('client').value.orders[0].billing).toEqual(billing);
  expect(service.logger.warn).toHaveBeenCalledWith(expect.stringContaining('FBS billing refresh failed'));
  expect(service.fbsBackgroundRefreshRunning).toBe(false);
});

it('retains the legacy background path when the flag is disabled', async () => {
  vi.stubEnv(flag, 'false');
  const { service, events } = backgroundFixture();
  await service.refreshAllFbsClients();
  expect(events).toEqual(['orders']);
  expect(service.logger.warn).toHaveBeenCalledWith(expect.stringContaining('FBS refresh failed'));
});

it('places successfully recalculated billing in the refreshed cache', async () => {
  vi.stubEnv(flag, 'true');
  const { service } = backgroundFixture();
  service.ensureFbsProcessingCharges.mockResolvedValue(new Map([['WILDBERRIES:wb:a', { chargeId: 'current', totalRub: 12 }]]));
  await service.refreshAllFbsClients();
  expect(service.fbsOrdersCache.get('client').value.orders[0].billing).toEqual({ chargeId: 'current', totalRub: 12 });
});

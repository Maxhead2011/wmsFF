import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixtureState = vi.hoisted(() => ({ free: 20, read: vi.fn() }));
vi.mock('../src/modules/marketplace-connections/multishop-stock-reader', () => ({ readSharedStock: fixtureState.read }));
vi.mock('../src/modules/marketplace-connections/marketplace-product-links', () => ({ productLinksEnabled: () => true,
  readProductLinks: async () => [{ id: 'wb-link', connectionId: 'wb', skuId: 'sku', marketplace: 'WILDBERRIES', productId: '1:2', offerId: 'barcode', status: 'LINKED', updatedAt: 'v1' },
    { id: 'oz-link', connectionId: 'oz', skuId: 'sku', marketplace: 'OZON', productId: '10', offerId: 'offer', status: 'LINKED', updatedAt: 'v1' }] }));
import { MultishopStockSyncService } from '../src/modules/marketplace-connections/multishop-stock-sync.service';

const config = { groups: [{ id: 'g', name: 'Пара', warehouseId: 'msk', mode: 'SHARED', safetyReserve: 0, lowStockThreshold: 2,
  members: [{ connectionId: 'wb', percent: 50, priority: 0 }, { connectionId: 'oz', percent: 50, priority: 1 }] }], assignments: [{ skuId: 'sku', groupId: 'g' }] };
function fixture() {
  const values = new Map<string, any>([['marketplace.multishop.draft.v1:client', { revision: 'draft', config }]]);
  const accounts = [{ id: 'wb', marketplace: 'WILDBERRIES', fbsExecutionWarehouseId: 'msk', fbsWarehouseId: '1' }, { id: 'oz', marketplace: 'OZON', fbsExecutionWarehouseId: 'msk', fbsWarehouseId: '2' }];
  const db: any = { $executeRaw: async () => 1, systemSetting: {
    findUnique: async ({ where }: any) => values.has(where.key) ? { key: where.key, value: structuredClone(values.get(where.key)) } : null,
    findMany: async ({ where }: any) => [...values].filter(([key]) => key.startsWith(where.key.startsWith)).map(([key, value]) => ({ key, value: structuredClone(value) })),
    upsert: async ({ where, create, update }: any) => { values.set(where.key, structuredClone(values.has(where.key) ? update.value : create.value)); },
    update: async ({ where, data }: any) => { values.set(where.key, structuredClone(data.value)); },
  }, clientMarketplaceConnection: { findMany: async () => accounts }, fbsWarehouseRoutingRule: { findMany: async () => [] },
    fbsStockAllocationPolicy: { findUnique: async () => null }, sku: { findMany: async () => [{ id: 'sku', name: 'Товар', size: '52' }] }, auditLog: { create: vi.fn(async () => ({})) } };
  db.$transaction = async (action: any) => action(db);
  const groups: any = { authorize: vi.fn(), read: async () => ({ revision: 'draft', config }) };
  const service = new MultishopStockSyncService(db, groups, { readMultishopWildberriesOrders: async () => [] } as any, { assertEnabled: async () => {} } as any);
  const stock: Record<string, number> = { wb: 20, oz: 20 };
  const transport = { ozonPending: async () => [], observe: vi.fn(async (_a: any, target: any) => stock[target.connectionId]), write: vi.fn(async (_a: any, target: any, amount: number) => { stock[target.connectionId] = amount; }) };
  (service as any).transport = transport;
  return { service, stock, transport, db, values, user: { id: 'admin' } as any };
}
describe('shared stock synchronization lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
    vi.stubEnv('WMS_MULTISHOP_PUBLICATION_ENABLED', 'true'); vi.stubEnv('WMS_MULTISHOP_STOCK_ENABLED', 'true');
    fixtureState.free = 20; fixtureState.read.mockImplementation(async (_db, _client, _warehouse, ids) => ({ revision: 'snapshot', quantities: new Map(ids.map((id: string) => [id, { available: 20, reserved: 20 - fixtureState.free, free: fixtureState.free }])) }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  // TEST: complete activate/order/reserve/verify/stop lifecycle, without external writes.
  it('synchronizes a common sale to both shops, then stops only after read-back zero', async () => {
    const f = fixture();
    await f.service.activate('client', { revision: 'draft' }, f.user);
    await f.service.tick(); expect(f.transport.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(121_000); fixtureState.free = 19;
    await f.service.tick(); expect(f.stock).toEqual({ wb: 19, oz: 19 });
    expect((await f.service.status('client', f.user)).jobs[0].status).toBe('DECREASE');
    vi.advanceTimersByTime(31_000); await f.service.tick();
    expect((await f.service.status('client', f.user)).jobs[0].status).toBe('DONE');
    await f.service.stop('client', f.user); await f.service.tick();
    expect(f.stock).toEqual({ wb: 19, oz: 19 }); // Keep the provider's per-product cooldown.
    vi.advanceTimersByTime(31_000); await f.service.tick();
    expect(f.stock).toEqual({ wb: 0, oz: 0 });
    expect((await f.service.status('client', f.user)).status).toBe('STOPPING');
    vi.advanceTimersByTime(31_000); await f.service.tick();
    expect((await f.service.status('client', f.user)).status).toBe('OFF');
  });
  it('can stop safely before the first scheduled job was created', async () => {
    const f = fixture(); await f.service.activate('client', { revision: 'draft' }, f.user); await f.service.stop('client', f.user);
    vi.advanceTimersByTime(121_000); await f.service.tick();
    expect(f.stock).toEqual({ wb: 0, oz: 0 });
    expect((await f.service.status('client', f.user)).status).toBe('STOPPING');
  });
  it('does not publish when the stock snapshot fails', async () => {
    const f = fixture(); await f.service.activate('client', { revision: 'draft' }, f.user);
    vi.advanceTimersByTime(121_000); fixtureState.read.mockRejectedValue(new Error('incomplete snapshot'));
    await f.service.tick(); expect(f.transport.write).not.toHaveBeenCalled();
    expect((await f.service.status('client', f.user)).issue).toContain('не завершена');
  });
  // TEST: a slow provider read must never authorize a stale stock increase.
  it('defers publication when observations outlive the order snapshot', async () => {
    const f = fixture(); await f.service.activate('client', { revision: 'draft' }, f.user);
    vi.advanceTimersByTime(121_000); f.stock.wb = 0; f.stock.oz = 0;
    f.transport.observe.mockImplementation(async (_a, target) => { vi.advanceTimersByTime(121_000); return f.stock[target.connectionId]; });
    await f.service.tick(); expect(f.transport.write).not.toHaveBeenCalled();
    expect((await f.service.status('client', f.user)).issue).toContain('не завершена');
  });
  it('retains one initial plan per SKU when applying the configuration repeatedly', async () => {
    const f = fixture(); await f.service.activate('client', { revision: 'draft' }, f.user);
    await f.service.activate('client', { revision: 'draft' }, f.user);
    expect(f.values.get('marketplace.multishop.active.v1:client').initialPlans).toHaveLength(1);
  });
  it('rejects an outdated confirmation before activating', async () => {
    const f = fixture(); await expect(f.service.activate('client', { revision: 'stale' }, f.user)).rejects.toThrow('изменились');
    expect((await f.service.status('client', f.user)).status).toBe('OFF');
  });
  it('requires complete provider observations before activation', async () => {
    const f = fixture(); f.transport.observe.mockResolvedValue(null as any);
    await expect(f.service.activate('client', { revision: 'draft' }, f.user)).rejects.toThrow('не подтвердил');
    expect(f.transport.write).not.toHaveBeenCalled();
  });
});

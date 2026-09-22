import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextAutoAssembly, parseAutoAssembly, emptyAutoAssembly } from '../src/modules/administration/auto-assembly-policy';
import { withFbsAssemblyLock } from '../src/modules/marketplace-connections/fbs-assembly-lock';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { AutoAssemblyService } from '../src/modules/administration/auto-assembly.service';
afterEach(() => vi.unstubAllEnvs());
// TEST: scheduling is independent from the API host's timezone.
describe('auto assembly schedule', () => {
  it('uses Moscow time and advances across midnight', () => {
    expect(nextAutoAssembly(['00:00', '06:00'], new Date('2026-09-22T20:59:00Z')).toISOString()).toBe('2026-09-22T21:00:00.000Z');
    expect(nextAutoAssembly(['00:00', '06:00'], new Date('2026-09-22T21:00:00Z')).toISOString()).toBe('2026-09-23T03:00:00.000Z');
  });
  it('requires explicit direction selection before enabling', () => expect(() => parseAutoAssembly({ ...emptyAutoAssembly, enabled: true })).toThrow());
  it.each(['24:00', '06:90', '6:00', ''])('rejects invalid time %s', time => expect(() => parseAutoAssembly({ ...emptyAutoAssembly, times: [time] })).toThrow());
  it('deduplicates times', () => expect(parseAutoAssembly({ ...emptyAutoAssembly, times: ['06:00', '06:00'] }).times).toEqual(['06:00']));
});
describe('manual and automatic assembly coordination', () => {
  it('does not enter a competing action while a client is being processed', async () => {
    vi.stubEnv('WMS_AUTO_ASSEMBLY_ENABLED', 'true');
    let locked = false;
    const db = { $transaction: async (action: any) => {
      let acquired = false;
      try { return await action({ $queryRaw: async () => { acquired = !locked; if (acquired) locked = true; return [{ locked: acquired }]; } }); }
      finally { if (acquired) locked = false; }
    } };
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const manual = withFbsAssemblyLock(db as never, 'client', () => gate);
    await Promise.resolve(); await Promise.resolve();
    const auto = vi.fn();
    await expect(withFbsAssemblyLock(db as never, 'client', auto)).rejects.toThrow('уже выполняется');
    expect(auto).not.toHaveBeenCalled(); release(); await manual;
    await withFbsAssemblyLock(db as never, 'client', auto); expect(auto).toHaveBeenCalledOnce();
  });
  it('preserves other installations when disabled', async () => {
    vi.stubEnv('WMS_AUTO_ASSEMBLY_ENABLED', 'false');
    const action = vi.fn().mockResolvedValue(42);
    expect(await withFbsAssemblyLock({} as never, 'client', action)).toBe(42);
  });
});
function setup(marketplace = 'WILDBERRIES') {
  vi.stubEnv('WMS_AUTO_ASSEMBLY_ENABLED', 'true');
  const db = { $transaction: (fn: any) => fn({ $queryRaw: async () => [{ locked: true }] }),
    clientMarketplaceConnection: { findUniqueOrThrow: async () => ({ id: 'cab', clientId: 'client', marketplace, isActive: true, fbsExecutionWarehouseId: 'wms', fbsAutoRouteNewWarehouses: true }) },
    fbsWarehouseRoutingRule: { findMany: async () => [] }, fbsTsdAssembly: { findMany: async () => [{ orderId: 'physical' }] } };
  const service = new MarketplaceConnectionsService(db as never, { requireClientAccess: vi.fn() } as never);
  const order = { id: 'new', connectionId: 'cab', marketplace, category: 'active', supplierStatus: marketplace === 'OZON' ? 'awaiting_packaging' : 'new', product: { id: 'sku' }, warehouseId: 'seller', warehouseName: 'Москва' };
  vi.spyOn(service as any, 'loadFbsOrdersUncached').mockResolvedValue({ orders: [order, { ...order, id: 'manual', request: { id: 'existing' } }, { ...order, id: 'physical' }, { ...order, id: 'supply', supplyId: 'WB-1' }, { ...order, id: 'cancelled', category: 'cancelled' }] } as never);
  const create = vi.spyOn(service as any, 'createFbsRequestUnlocked').mockResolvedValue({ request: { number: 12 } });
  const assemble = vi.spyOn(service as any, 'assembleFbsOrdersUnlocked').mockResolvedValue({});
  return { service, create, assemble };
}
describe('scheduled assembly selection', () => {
  it('skips manually claimed, scanned, cancelled and already supplied orders', async () => {
    const { service, create, assemble } = setup();
    const result = await service.runAutoAssembly('cab', { allWarehouses: true, warehouseIds: [] }, {} as never);
    expect(create.mock.calls[0][0].orders).toEqual([{ connectionId: 'cab', id: 'new' }]);
    expect(result.skipped).toBe(3); expect(assemble).toHaveBeenCalledOnce();
  });
  it('never confirms shipping to Ozon', async () => {
    const { service, create, assemble } = setup('OZON');
    await service.runAutoAssembly('cab', { allWarehouses: true, warehouseIds: [] }, {} as never);
    expect(create).toHaveBeenCalledOnce(); expect(assemble).not.toHaveBeenCalled();
  });
  it('preview creates neither requests nor WB supplies', async () => {
    const { service, create, assemble } = setup();
    const result = await service.runAutoAssembly('cab', { allWarehouses: true, warehouseIds: [] }, {} as never, true);
    expect(result.groups[0].count).toBe(1); expect(create).not.toHaveBeenCalled(); expect(assemble).not.toHaveBeenCalled();
  });
  it('respects selected directions', async () => {
    const { service, create } = setup();
    await service.runAutoAssembly('cab', { allWarehouses: false, warehouseIds: ['other'] }, {} as never);
    expect(create).not.toHaveBeenCalled();
  });
  it('reports the durable request after a WB failure', async () => {
    const { service, assemble } = setup(); assemble.mockRejectedValue(new Error('WB unavailable'));
    const result = await service.runAutoAssembly('cab', { allWarehouses: true, warehouseIds: [] }, {} as never);
    expect(result.groups[0]).toMatchObject({ requestNumber: 12, error: 'WB unavailable' });
  });
});
// TEST: duplicate worker ticks cannot claim the same scheduled occurrence twice.
describe('durable schedule claim', () => {
  it('runs a due occurrence only for the winning compare-and-swap', async () => {
    const value = { ...emptyAutoAssembly, enabled: true, allWarehouses: true, ownerId: 'admin', nextAt: '2020-01-01T00:00:00Z' };
    let claimed = false;
    const db = { systemSetting: { findMany: vi.fn().mockResolvedValue([{ key: 'fbs.autoAssembly.config.cab', value, updatedAt: new Date() }]), updateMany: vi.fn(async () => { const count = claimed ? 0 : 1; claimed = true; return { count }; }) }, user: { findUnique: vi.fn().mockResolvedValue({ id: 'admin', email: 'a', name: 'Admin', status: 'ACTIVE', isDemo: false, roles: [{ role: { code: 'ADMIN', permissions: [{ permission: { code: 'system:admin' } }] } }] }) } };
    const service = new AutoAssemblyService(db as never, {} as never, {} as never);
    const run = vi.spyOn(service, 'run').mockResolvedValue({});
    await Promise.all([service.tick(), service.tick()]);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][2]).toBe(value.nextAt);
  });
});
// TEST: manual collection of unrelated orders remains available during an automatic batch.
it('locks only intersecting order identities', async () => {
  vi.stubEnv('WMS_AUTO_ASSEMBLY_ENABLED', 'true');
  const locks = new Set<string>();
  const db = { $transaction: async (fn: any) => { const owned: string[] = []; try { return await fn({ $queryRaw: async (_sql: unknown, key: string) => { if (locks.has(key)) return [{ locked: false }]; locks.add(key); owned.push(key); return [{ locked: true }]; } }); } finally { owned.forEach(key => locks.delete(key)); } } };
  let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(r => { release = r; }); const ready = new Promise<void>(r => { started = r; });
  const auto = withFbsAssemblyLock(db as never, 'client', async () => { started(); await gate; }, ['cab:100']);
  await ready;
  expect(await withFbsAssemblyLock(db as never, 'client', async () => 'manual available', ['cab:200'])).toBe('manual available');
  await expect(withFbsAssemblyLock(db as never, 'client', async () => true, ['cab:100'])).rejects.toThrow('уже выполняется');
  release(); await auto; expect(locks.size).toBe(0);
});
it('rechecks manual ownership after selecting the automatic batch', async () => {
  const { service, create } = setup();
  const fresh = { id: 'new', connectionId: 'cab', marketplace: 'WILDBERRIES', category: 'active', supplierStatus: 'new', product: { id: 'sku' }, warehouseId: 'seller' };
  (service as any).loadFbsOrdersUncached.mockResolvedValueOnce({ orders: [fresh] }).mockResolvedValueOnce({ orders: [{ ...fresh, request: { id: 'manual-won' } }] });
  const result = await service.runAutoAssembly('cab', { allWarehouses: true, warehouseIds: [] }, {} as never);
  expect(create).not.toHaveBeenCalled(); expect(result.groups[0].count).toBe(0); expect(result.skipped).toBe(1);
});

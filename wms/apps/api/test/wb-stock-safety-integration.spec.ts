import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { WbStockObservations } from '../src/modules/marketplace-connections/wb-stock-observations';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
beforeEach(() => vi.stubEnv('WMS_WB_STOCK_FINE_SETTINGS', 'true'));
function setup() {
  const publications = ['1', '2'].map(warehouseId => ({ id: warehouseId, clientId: 'c', connectionId: 'conn', warehouseId, skuId: 's', enabled: true, saleLimit: null, sku: { id: 's', marketplaceProductId: '10:20' } }));
  const proofs: any[] = [];
  const db: any = { clientMarketplaceConnection: { findFirst: vi.fn(async () => ({ id: 'conn', clientId: 'c', apiKey: 'test', fbsWarehouseId: '1' })) },
    fbsStockPublication: { findMany: vi.fn(async () => publications), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({})) },
    wbStockPublicationCheck: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({})) },
    $transaction: async (items: any) => Promise.all(items) };
  vi.spyOn(WbStockObservations.prototype, 'inRebalance').mockReturnValue(true);
  vi.spyOn(WbStockObservations.prototype, 'locked').mockImplementation(async (_id, _rebalance, action) => action());
  vi.spyOn(WbStockObservations.prototype, 'guard').mockResolvedValue(undefined);
  vi.spyOn(WbStockObservations.prototype, 'observe').mockResolvedValue(undefined);
  vi.spyOn(WbStockObservations.prototype, 'recorder').mockReturnValue(async row => { proofs.push(row); });
  const scopes = { requireClientAccess: vi.fn() };
  const service: any = new MarketplaceConnectionsService(db, scopes as never);
  service.stockControl = { assertEnabled: vi.fn(), isEnabled: vi.fn(async () => false) };
  service.stockAllocation = { activePolicy: vi.fn(async () => ({ id: 'policy', primaryWarehouseId: '1', lowStockThreshold: 0, overrides: [], shares: [{ warehouseId: '1', percent: 50, isPrimary: true }, { warehouseId: '2', percent: 50, isPrimary: false }] })), markSync: vi.fn() };
  vi.spyOn(service, 'resolveFbsExecutionWarehouseId').mockResolvedValue('msk');
  const plan = vi.spyOn(service, 'calculateFbsRelabelStockPlan').mockResolvedValue({ reserve: { mode: 'NONE', value: 0 }, quantities: new Map([['s', { skuId: 's', chrtId: 20, sellable: 10 }]]), meta: new Map(), skuRules: new Map() });
  const actual = new Map([['1', 0], ['2', 10]]);
  const read = vi.spyOn(service, 'fetchWildberriesStockAmounts').mockImplementation(async (_key, warehouse) => new Map([[20, actual.get(warehouse as string)]]));
  const send = vi.spyOn(service, 'putWildberriesStocksRaw').mockImplementation(async (_client, _key, warehouse, rows) => { actual.set(warehouse as string, (rows as any[])[0].amount); });
  return { service, db, scopes, actual, read, send, plan, proofs };
}
describe('real allocation service with verified publication', () => {
  // TEST: missing size must not receive a PUT or a successful publication timestamp.
  it('leaves an unknown size untouched and reports it instead of claiming success', async () => {
    const { service, read, send, db, proofs } = setup();
    read.mockResolvedValue(new Map());
    const result = await service.syncAllocatedFbsStocksForConnection('c', 'conn');
    expect(result.synced).toBe(0);
    expect(result.publishedAmount).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(db.fbsStockPublication.update).not.toHaveBeenCalled();
    expect(db.fbsStockPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { lastError: expect.stringContaining('пропущен') } }));
    expect(service.stockAllocation.markSync).toHaveBeenCalledWith('policy', expect.stringContaining('Пропущено'));
    expect(proofs.every((r: any) => r.status === 'UNCONFIRMED')).toBe(true);
  });
  // TEST: service wiring, not just the pure plan, must lower warehouse 2 before raising warehouse 1.
  it('verifies decreases first using fresh reads and persists only confirmed totals', async () => {
    const { service, send, read, db } = setup();
    await service.syncAllocatedFbsStocksForConnection('c', 'conn');
    expect(send.mock.calls.map(args => args[2])).toEqual(['2', '1']);
    expect(read.mock.calls.every(args => args[3] === true)).toBe(true);
    expect(db.fbsStockPublication.update).toHaveBeenCalledTimes(2);
  });
  it('does not increase or claim success when WB acknowledges but ignores the decrease', async () => {
    const { service, send, db } = setup(); send.mockResolvedValue({});
    await expect(service.syncAllocatedFbsStocksForConnection('c', 'conn')).rejects.toThrow('не подтвердил');
    expect(send.mock.calls.map(args => args[2])).toEqual(['2']);
    expect(db.fbsStockPublication.update).not.toHaveBeenCalled();
    expect(service.stockAllocation.markSync).toHaveBeenCalledWith('policy', expect.any(String));
  });
  it('zeros previously published positions when the inventory plan becomes empty', async () => {
    const { service, plan, actual } = setup(); plan.mockResolvedValue({ quantities: new Map(), meta: new Map(), skuRules: new Map() });
    await service.syncAllocatedFbsStocksForConnection('c', 'conn');
    expect([...actual.values()]).toEqual([0, 0]);
  });
  it.each([true, false])('applies SKU block=%s or SKU reserve before splitting', async blocked => {
    const { service, plan, actual } = setup();
    plan.mockResolvedValue({ quantities: new Map([['s', { skuId: 's', chrtId: 20, sellable: 10 }]]), meta: new Map(), reserve: { mode: 'UNITS', value: 3 }, skuRules: new Map([['s', { reserve: { mode: 'UNITS', value: 6 }, blocked }]]) });
    await service.syncAllocatedFbsStocksForConnection('c', 'conn');
    expect([...actual.values()]).toEqual(blocked ? [0, 0] : [2, 2]);
  });
  // TEST: checking never enables publication and never calls a WB writer.
  it('checks bigint IDs and reports missing rows without marking them zero or stopping other rows', async () => {
    const { service, db, read, send } = setup();
    db.wbStockPublicationCheck.findMany.mockResolvedValue([
      { id: 'missing', warehouseId: '2', skuId: 'm', chrtId: 2331826459n, calculatedAmount: 5 },
      { id: 'known', warehouseId: '2', skuId: 's', chrtId: 20n, calculatedAmount: 5 },
    ]);
    const result = await service.checkFbsStockPublication({ clientId: 'c', connectionId: 'conn' }, {});
    expect(result).toMatchObject({ checked: 1, mismatches: 1, unconfirmed: 1 });
    expect(read.mock.calls[0][2]).toEqual([2331826459, 20]);
    expect(db.wbStockPublicationCheck.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'missing' }, data: expect.objectContaining({ status: 'UNCONFIRMED', observedAmount: null }) }));
    expect(send).not.toHaveBeenCalled();
  });

  // TEST: checking never enables publication and never calls a WB writer.
  it('checks actual WB amounts while outgoing management is disabled', async () => {
    const { service, db, send, scopes } = setup();
    db.wbStockPublicationCheck.findMany.mockResolvedValue([{ id: 'proof', warehouseId: '2', skuId: 's', chrtId: 20, calculatedAmount: 5 }]);
    const result = await service.checkFbsStockPublication({ clientId: 'c', connectionId: 'conn' }, {});
    expect(result).toMatchObject({ checked: 1, mismatches: 1 });
    expect(scopes.requireClientAccess).toHaveBeenCalledWith({}, 'c', 'read');
    expect(db.wbStockPublicationCheck.findMany).toHaveBeenCalledWith({ where: { clientId: 'c', connectionId: 'conn' } });
    expect(db.wbStockPublicationCheck.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'MISMATCH', observedAmount: 10 }) }));
    expect(send).not.toHaveBeenCalled();
    expect(service.stockControl.assertEnabled).not.toHaveBeenCalled();
  });
});

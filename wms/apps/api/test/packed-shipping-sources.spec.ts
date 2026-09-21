import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPackedShippingSources } from '../src/modules/stock/packed-shipping-sources';

const request = { id: 'request', clientId: 'client', items: [{ id: 'item', skuId: 'sku', quantity: 2 }] };
function fixture() {
  const packages = [{ id: 'package', clientId: 'client', packageCode: 'DEST', createdAt: new Date(0), updatedAt: new Date(0), items: [{ requestItemId: 'item', skuId: 'sku', quantity: 2 }] }];
  const movements = [{ boxId: 'destination', skuId: 'sku', quantity: 3 }, { boxId: 'destination', skuId: 'sku', quantity: -1 }];
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ phase: 'COMPLETED' }]), clientRequestPackage: { findMany: vi.fn().mockResolvedValue(packages) }, box: { findMany: vi.fn().mockResolvedValue([{ id: 'destination', code: 'DEST', warehouseId: 'warehouse' }]) }, stockMovement: { findMany: vi.fn().mockResolvedValue(movements) } };
  return { tx, packages, movements, read: () => readPackedShippingSources(tx as never, request, 'warehouse') };
}
describe('recorded FBO shipping sources', () => {
  afterEach(() => vi.unstubAllEnvs());
  // TEST: repacked goods must ship from their destination, with ledger reversals deducted.
  it('uses destination boxes proved by the request ledger', async () => {
    vi.stubEnv('WMS_PACKED_REQUEST_SHIPPING_ENABLED', 'true');
    const f = fixture();
    expect(await f.read()).toEqual([expect.objectContaining({ boxId: 'destination', requestItemId: 'item', skuId: 'sku', quantity: 2 })]);
    expect(f.tx.stockMovement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceDocument: 'request', clientId: 'client', warehouseId: 'warehouse', status: 'SHIPPING' } }));
  });
  it('does not query new tables when disabled', async () => {
    vi.stubEnv('WMS_PACKED_REQUEST_SHIPPING_ENABLED', 'false');
    const f = fixture(); expect(await f.read()).toBeNull(); expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('preserves the non-FBO path', async () => {
    vi.stubEnv('WMS_PACKED_REQUEST_SHIPPING_ENABLED', 'true');
    const f = fixture(); f.tx.$queryRaw.mockResolvedValue([]); expect(await f.read()).toBeNull(); expect(f.tx.clientRequestPackage.findMany).not.toHaveBeenCalled();
  });
  it.each(['unfinished', 'missing-box', 'wrong-item', 'short-ledger', 'extra-ledger', 'wrong-client', 'no-packages'])('blocks %s without falling back to other stock', async kind => {
    vi.stubEnv('WMS_PACKED_REQUEST_SHIPPING_ENABLED', 'true'); const f = fixture();
    if (kind === 'unfinished') f.tx.$queryRaw.mockResolvedValue([{ phase: 'PACKING' }]);
    if (kind === 'missing-box') f.tx.box.findMany.mockResolvedValue([]);
    if (kind === 'wrong-item') f.packages[0].items[0].requestItemId = 'foreign-item';
    if (kind === 'short-ledger') f.movements[0].quantity = 2;
    if (kind === 'extra-ledger') f.movements.push({ boxId: 'other', skuId: 'sku', quantity: 1 });
    if (kind === 'wrong-client') f.packages[0].clientId = 'other';
    if (kind === 'no-packages') f.tx.clientRequestPackage.findMany.mockResolvedValue([]);
    await expect(f.read()).rejects.toThrow();
  });
});

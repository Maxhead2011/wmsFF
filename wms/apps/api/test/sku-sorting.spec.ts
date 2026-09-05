import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkuCollectionService } from '../src/modules/inventory/sku-collection.service';

afterEach(() => vi.unstubAllEnvs());
describe('SKU sorting is storage, not fulfillment', () => {
  it('creates a route without reserving stock or KIZs', async () => {
    // TEST: a sorting request must not remove available stock from sales.
    vi.stubEnv('WMS_SKU_SORTING_ENABLED', 'true');
    const tx: any = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      sku: { findFirst: vi.fn().mockResolvedValue({ id: 'sku', name: 'Suit', needsChestnyZnak: true, barcodes: [{ value: '123' }] }) },
      stockBalance: { findMany: vi.fn().mockResolvedValue([{ id: 'balance', warehouseId: 'warehouse', clientId: 'client', skuId: 'sku', status: 'AVAILABLE', palletId: null, boxId: 'box', box: { id: 'box', code: 'BOX' }, quantity: 3 }]),
        delete: vi.fn(), update: vi.fn(), upsert: vi.fn() },
      stockMovement: { createMany: vi.fn() },
      productMark: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
      clientRequest: { create: vi.fn().mockResolvedValue({ id: 'request' }) },
    };
    const service = new SkuCollectionService({ $transaction: (fn: any) => fn(tx) } as never,
      { requireClientAccess: vi.fn() } as never, { balanceKey: () => 'key' } as never);
    vi.spyOn(service as any, 'summary').mockResolvedValue({ id: 'request' });
    await service.create({ clientId: 'client', skuId: 'sku' }, {
      id: 'user', activeWarehouseId: 'warehouse', permissionCodes: ['system:admin'], name: 'Test',
    } as never);
    expect(tx.stockBalance.delete).not.toHaveBeenCalled();
    expect(tx.stockBalance.upsert).not.toHaveBeenCalled();
    expect(tx.stockMovement.createMany).not.toHaveBeenCalled();
    expect(tx.productMark.updateMany).not.toHaveBeenCalled();
  });
});

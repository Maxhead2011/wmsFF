import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkuSortingService } from '../src/modules/inventory/sku-sorting.service';
import { SkuCollectionService } from '../src/modules/inventory/sku-collection.service';

afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_SKU_SORTING_ENABLED', 'true');
  const user: any = { id: 'user', activeWarehouseId: 'warehouse', permissionCodes: ['system:admin'] };
  const request = { id: 'request', clientId: 'client', warehouseId: 'warehouse', comment: 'old',
    skuCollectionSources: [{ id: 'source', sourceBoxId: 'box', sourceBoxCode: 'BOX', skuId: 'sku', plannedQuantity: 5, pickedQuantity: 2 }] };
  const tx: any = { $queryRaw: vi.fn(), clientRequest: { findFirst: vi.fn().mockResolvedValue(request), update: vi.fn() },
    inventorySession: { findFirst: vi.fn().mockResolvedValue(null) },
    stockBalance: { findMany: vi.fn().mockResolvedValue([{ id: 'reserved', quantity: 3, palletId: 'pallet' }]), delete: vi.fn(), upsert: vi.fn() },
    stockMovement: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 5 } }), createMany: vi.fn() },
    fbsTsdAssembly: { findFirst: vi.fn().mockResolvedValue(null) }, productMark: { updateMany: vi.fn() }, auditLog: { create: vi.fn() },
  };
  const service = new SkuSortingService({ $transaction: (fn: any) => fn(tx) } as any, { requireClientAccess: vi.fn() } as any,
    { balanceKey: () => 'available' } as any, { get: vi.fn() } as any, {} as any, {} as any);
  return { service, tx, user, request };
}
describe('legacy SKU sorting reservation release', () => {
  it('places an old PACKING unit with a balanced ledger instead of a new receipt', async () => {
    // TEST: old picked stock is moved, not received again as newly arrived goods.
    vi.stubEnv('WMS_SKU_SORTING_ENABLED', 'true');
    const picked = { id: 'scan', skuId: 'sku', sourceId: 'source', status: 'PICKED' };
    const tx: any = { $queryRaw: vi.fn(), skuCollectionScan: { findUnique: vi.fn().mockResolvedValue(picked), update: vi.fn() },
      clientRequest: { findFirst: vi.fn().mockResolvedValue({ id: 'request', clientId: 'client', warehouseId: 'warehouse' }) },
      productMark: { findFirst: vi.fn().mockResolvedValue({ id: 'mark', skuId: 'sku' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      box: { findFirst: vi.fn().mockResolvedValue({ id: 'target', code: 'TARGET', palletId: null }) },
      stockBalance: { findFirst: vi.fn().mockResolvedValue({ id: 'packing', quantity: 1, status: 'PACKING', warehouseId: 'warehouse', clientId: 'client', skuId: 'sku', boxId: null, palletId: null }), delete: vi.fn(), upsert: vi.fn() },
      stockMovement: { create: vi.fn().mockResolvedValue({ id: 'movement' }) }, skuCollectionSource: { update: vi.fn() },
    };
    const service = new SkuCollectionService({ ...tx, $transaction: (fn: any) => fn(tx) } as any,
      { requireClientAccess: vi.fn() } as any, { balanceKey: () => 'key' } as any);
    vi.spyOn(service as any, 'assertBarcode').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'refreshRequestStatus').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'summary').mockResolvedValue({ id: 'request' });
    await service.receive('request', { targetBoxCode: 'TARGET', barcode: '123', kiz: 'kiz' },
      { id: 'user', name: 'Test', activeWarehouseId: 'warehouse', permissionCodes: ['system:admin'] } as any);
    expect(tx.stockMovement.create.mock.calls.map((c: any) => [c[0].data.status, c[0].data.quantity, c[0].data.type]))
      .toEqual([['PACKING', -1, 'MOVE'], ['AVAILABLE', 1, 'MOVE']]);
    expect(tx.productMark.updateMany.mock.calls[0][0].where.value).toBe('kiz');
  });
  it('releases exactly the unpicked legacy units and never touches PACKING marks', async () => {
    // TEST: 5 originally reserved, 2 already picked => release only 3, preserving total stock.
    const { service, tx, user } = fixture();
    await service.start('request', user);
    expect(tx.stockBalance.upsert.mock.calls[0][0].create).toMatchObject({ quantity: 3, status: 'AVAILABLE', boxId: 'box' });
    expect(tx.stockMovement.createMany.mock.calls[0][0].data.map((x: any) => x.quantity)).toEqual([-3, 3]);
    expect(tx.productMark.updateMany.mock.calls[0][0].where.status).toBe('RESERVED');
  });
  it('rejects ambiguous or externally used reserves before writing', async () => {
    // TEST: no broad unreserve, even when the user requests a storage workflow.
    const { service, tx, user } = fixture();
    tx.stockBalance.findMany.mockResolvedValue([{ id: 'reserved', quantity: 4 }]);
    await expect(service.start('request', user)).rejects.toThrow('однозначно');
    expect(tx.stockBalance.delete).not.toHaveBeenCalled();
  });
  it('is read-only on retry after the mode marker was committed', async () => {
    // TEST: repeat starts cannot release stock twice.
    const { service, tx, user, request } = fixture(); request.comment = '[SKU_SORTING_V2]';
    await service.start('request', user);
    expect(tx.stockBalance.findMany).not.toHaveBeenCalled();
    expect(tx.productMark.updateMany).not.toHaveBeenCalled();
  });
});

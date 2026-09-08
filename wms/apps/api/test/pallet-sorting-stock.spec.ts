import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
afterEach(() => vi.unstubAllEnvs());

describe('sorting unit movement', () => {
  function fixture() {
    vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
    const service = Object.create(StockOperationsService.prototype) as any;
    service.loadTsdTransferSourceBox = vi.fn().mockResolvedValue({ id: 'source', clientId: 'client', code: 'SOURCE', warehouseId: 'wh' });
    service.resolveStorageBoxTransferItem = vi.fn().mockResolvedValue({ productMarkId: 'mark', sku: { id: 'sku' }, scanCode: 'kiz' });
    service.applyTransferBetweenBoxes = vi.fn();
    const tx: any = {
      box: { findUnique: vi.fn().mockResolvedValue({ id: 'target', code: 'TARGET', clientId: 'client', warehouseId: 'wh', status: 'active' }) },
      stockMovement: { findUnique: vi.fn().mockResolvedValue({ id: 'inbound' }) },
      productMark: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn() },
    };
    const input = { fromBoxCode: 'SOURCE', toBoxCode: 'TARGET', barcode: 'barcode', kiz: 'kiz', idempotencyKey: 'op', sessionId: 'session' };
    return { service, tx, input, user: { id: 'admin', activeWarehouseId: 'wh', roleCodes: ['ADMIN'] } };
  }
  it('uses the existing paired MOVE operation and moves the mark, without early archival', async () => {
    // TEST: no receipt, FBS shipment, or independent transaction is created by sorting.
    const { service, tx, input, user } = fixture();
    await service.transferSortingUnit(tx, input, user);
    expect(service.applyTransferBetweenBoxes).toHaveBeenCalledWith(tx, expect.objectContaining({ quantity: 1, status: 'AVAILABLE', sourceDocument: 'PALLET_SORTING:session' }), 'wh');
    expect(tx.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'mark', boxId: 'source', status: 'AVAILABLE' }, data: { boxId: 'target', stockMovementId: 'inbound' } }));
    expect(tx.box.update).toBeUndefined();
  });
  it('rejects the transaction when a concurrent operation took the KIZ', async () => {
    // TEST: rejection propagates to the transaction owner; actual SQL rollback is an integration gate.
    const { service, tx, input, user } = fixture();
    tx.productMark.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.transferSortingUnit(tx, input, user)).rejects.toThrow('КИЗ');
  });
  it('rejects foreign or archived destinations before moving stock', async () => {
    // TEST: a valid source does not authorize another client/branch.
    const { service, tx, input, user } = fixture();
    tx.box.findUnique.mockResolvedValue({ id: 'target', clientId: 'foreign', warehouseId: 'wh', status: 'active' });
    await expect(service.transferSortingUnit(tx, input, user)).rejects.toThrow();
    expect(service.applyTransferBetweenBoxes).not.toHaveBeenCalled();
  });
});

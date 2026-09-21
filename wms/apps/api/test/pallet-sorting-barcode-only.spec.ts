import { afterEach, expect, it, vi } from 'vitest';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';
const user: any = { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' };
// TEST: resumed legacy sessions keep KIZ mode, and retries cannot change the saved mode.
it('preserves a saved scan mode when replaying session creation', async () => {
  fixture();
  const service: any = Object.create(PalletSortingService.prototype);
  service.boxCodes = { normalize: async (x: string) => x };
  const saved: any = { sourceCode: 'SOURCE' };
  service.load = vi.fn(async () => saved);
  const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([{ createdByUserId: user.id }]) };
  service.prisma = { $transaction: (fn: any) => fn(tx) };
  await expect(service.start({ id: 'session', code: 'SOURCE' }, user)).resolves.toBe(saved);
  await expect(service.start({ id: 'session', code: 'SOURCE', scanMode: 'BARCODE_ONLY' }, user)).rejects.toThrow('режимом');
  saved.scanMode = 'BARCODE_ONLY';
  await expect(service.start({ id: 'session', code: 'SOURCE', scanMode: 'BARCODE_ONLY' }, user)).resolves.toBe(saved);
});
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  vi.stubEnv('WMS_PALLET_SORTING_BARCODE_ONLY', 'true');
  const service: any = Object.create(StockOperationsService.prototype);
  service.clientScopes = { requireClientAccess: vi.fn() };
  service.applyTransferBetweenBoxes = vi.fn().mockResolvedValue({ status: 'APPLIED' });
  const source = { id: 'source', code: 'SOURCE', clientId: 'client', warehouseId: 'wh', status: 'active' };
  const target = { ...source, id: 'target', code: 'TARGET' };
  const tx: any = { $queryRaw: vi.fn(), box: { findUnique: vi.fn(async ({ where }: any) => where.code === 'SOURCE' ? source : target) },
    barcode: { findMany: vi.fn().mockResolvedValue([{ sku: { id: 'sku' } }]) },
    productMark: { findFirst: vi.fn().mockResolvedValue(null) },
    stockMovement: { findUnique: vi.fn().mockResolvedValue({ id: 'in' }) } };
  const input = { fromBoxCode: 'SOURCE', toBoxCode: 'TARGET', barcode: '123', sessionId: 'session', idempotencyKey: 'scan1' };
  return { service, tx, input, source, target };
}
it('moves exactly one available unit without writing or selecting a KIZ', async () => {
  // TEST: one barcode scan = one unit, not the box quantity.
  const f = fixture();
  await f.service.transferSortingBarcodeUnit(f.tx, f.input, user);
  expect(f.service.applyTransferBetweenBoxes).toHaveBeenCalledWith(f.tx, expect.objectContaining({ quantity: 1, status: 'AVAILABLE', skuId: 'sku', fromBoxCode: 'SOURCE', toBoxCode: 'TARGET' }), 'wh');
});
it('requires marked goods to use barcode plus KIZ before touching stock', async () => {
  // TEST: never pick an arbitrary mark when barcode-only mode is selected.
  const f = fixture(); f.tx.productMark.findFirst.mockResolvedValue({ id: 'mark' });
  await expect(f.service.transferSortingBarcodeUnit(f.tx, f.input, user)).rejects.toThrow('ШК + КИЗ');
  expect(f.service.applyTransferBetweenBoxes).not.toHaveBeenCalled();
});
it('rejects a different client, branch or disabled installation', async () => {
  // TEST: no cross-client borrowing and no effect on the sold VM.
  const f = fixture(); f.target.clientId = 'other';
  await expect(f.service.transferSortingBarcodeUnit(f.tx, f.input, user)).rejects.toThrow();
  f.target.clientId = 'client'; f.target.warehouseId = 'other';
  await expect(f.service.transferSortingBarcodeUnit(f.tx, f.input, user)).rejects.toThrow();
  vi.stubEnv('WMS_PALLET_SORTING_BARCODE_ONLY', 'false');
  await expect(f.service.transferSortingBarcodeUnit(f.tx, f.input, user)).rejects.toThrow();
  expect(f.service.applyTransferBetweenBoxes).not.toHaveBeenCalled();
});
it('does not invent stock after an insufficient-balance rejection', async () => {
  // TEST: barcode-only sorting has no implicit found-unit receipt.
  const f = fixture(); f.service.applyTransferBetweenBoxes.mockRejectedValue(new Error('Недостаточно остатка'));
  await expect(f.service.transferSortingBarcodeUnit(f.tx, f.input, user)).rejects.toThrow('Недостаточно');
});
it('dispatches barcode mode without KIZ parsing and ignores a replay for the counter', async () => {
  // TEST: session branch supports unmarked goods; same operation is not another unit.
  fixture();
  const service: any = Object.create(PalletSortingService.prototype);
  service.boxCodes = { normalize: async (x: string) => x };
  service.assertUnclaimed = service.assertMovementAllowed = service.resetAffectedRoutes = service.audit = vi.fn();
  service.stock = { transferSortingBarcodeUnit: vi.fn().mockResolvedValue({ alreadyApplied: false, skuId: 'sku', movementId: 'in' }) };
  const state: any = { id: 's', scanMode: 'BARCODE_ONLY', stage: 'FORMING', warehouseId: 'wh', clientId: 'client', activeTargetId: 'target', sources: [{ id: 'source', code: 'SOURCE', scanned: true }], targets: [{ id: 'target', code: 'TARGET', quantity: 0 }], moves: [] };
  await service.move({}, state, { operationId: 'op', barcode: '123', sourceBoxCode: 'SOURCE' }, user);
  expect(state.moves).toHaveLength(1); expect(state.targets[0].quantity).toBe(1);
  service.stock.transferSortingBarcodeUnit.mockResolvedValue({ alreadyApplied: true });
  await service.move({}, state, { operationId: 'op', barcode: '123', sourceBoxCode: 'SOURCE' }, user);
  expect(state.moves).toHaveLength(1); expect(state.targets[0].quantity).toBe(1);
});

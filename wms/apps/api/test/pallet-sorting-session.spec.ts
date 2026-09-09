import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';

const state = () => ({ id: 'session', clientId: 'client', warehouseId: 'wh', stage: 'CHECKING', sourceCode: 'PALLET', sourcePalletId: 'pallet', sources: [{ id: 'a', code: 'A', scanned: false, archived: false }], targets: [], moves: [], pendingRoutes: [], version: 1 });
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const service = Object.create(PalletSortingService.prototype) as any;
  service.boxCodes = { normalize: vi.fn(async (x: string) => x.trim().toUpperCase()) };
  service.previewInTx = vi.fn().mockResolvedValue({ fingerprint: 'fresh', quantity: 2, boxes: [] });
  service.archiveSources = vi.fn();
  service.audit = vi.fn();
  service.resetAffectedRoutes = vi.fn();
  return { service, state: state(), tx: {}, user: { id: 'admin' } };
}
it('rejects stale write-off consent without changing stock', async () => {
  // TEST: preview/apply must use the same current stock and task fingerprint.
  const f = fixture();
  await expect(f.service.runAction(f.tx, f.state, { action: 'ARCHIVE_MISSING', fingerprint: 'stale', confirmWriteOff: true }, f.user)).rejects.toThrow('свежие');
  expect(f.service.archiveSources).not.toHaveBeenCalled();
});
it('cannot start forming boxes until missing source boxes are resolved', async () => {
  // TEST: absence is not silently treated as a physical count of zero.
  const f = fixture();
  await expect(f.service.runAction(f.tx, f.state, { action: 'BEGIN_FORMING' }, f.user)).rejects.toThrow();
  expect(f.state.stage).toBe('CHECKING');
});
it('scanning the same source twice does not change its quantity or create a receipt', async () => {
  // TEST: source scans identify boxes, not inventory movements.
  const f = fixture();
  await f.service.runAction(f.tx, f.state, { action: 'SCAN_SOURCE', code: 'a' }, f.user);
  await f.service.runAction(f.tx, f.state, { action: 'SCAN_SOURCE', code: 'A' }, f.user);
  expect(f.state.sources).toHaveLength(1);
  expect(f.state.sources[0].scanned).toBe(true);
  expect(f.service.archiveSources).not.toHaveBeenCalled();
});
it('closing a destination does not finish or archive the sources', async () => {
  // TEST: the two buttons have different stock consequences.
  const f = fixture();
  Object.assign(f.state, { stage: 'FORMING', targets: [{ id: 'target', code: 'TARGET', closed: false }], activeTargetId: 'target' });
  await f.service.runAction(f.tx, f.state, { action: 'CLOSE_TARGET' }, f.user);
  expect(f.state.stage).toBe('FORMING');
  expect((f.state.targets[0] as any).closed).toBe(true);
  expect(f.service.archiveSources).not.toHaveBeenCalled();
});
it('cannot finish with an open destination or without separate shortage consent', async () => {
  // TEST: no hidden write-off at the end of a pallet.
  const f = fixture();
  Object.assign(f.state, { stage: 'FORMING', activeTargetId: 'target' });
  await expect(f.service.runAction(f.tx, f.state, { action: 'COMPLETE', fingerprint: 'fresh', confirmWriteOff: true }, f.user)).rejects.toThrow();
  (f.state as any).activeTargetId = null;
  await expect(f.service.runAction(f.tx, f.state, { action: 'COMPLETE', fingerprint: 'fresh', confirmWriteOff: false }, f.user)).rejects.toThrow('подтверждение');
  expect(f.service.archiveSources).not.toHaveBeenCalled();
});
it('writes off only remaining balances and leaves PACKING/SHIPPING mark history unchanged', async () => {
  // TEST: picked stock must not be written off or have its KIZ changed a second time.
  const f = fixture();
  delete f.service.archiveSources;
  f.service.resetAffectedRoutes = vi.fn();
  f.service.emptyBoxes = { detachIfArchivedAndEmpty: vi.fn() };
  const tx: any = { stockBalance: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, stockMovement: { create: vi.fn() },
    productMark: { updateMany: vi.fn() }, box: { update: vi.fn() } };
  const preview = { fingerprint: 'fresh', quantity: 2, affectedOrders: [], boxes: [{ id: 'a', code: 'A', balances: [{ id: 'balance', skuId: 'sku', quantity: 2, status: 'AVAILABLE', updatedAt: new Date(), palletId: null }] }] };
  await f.service.archiveSources(tx, f.state, preview, f.user);
  expect(tx.stockMovement.create.mock.calls[0][0].data).toMatchObject({ type: 'INVENTORY_ADJUSTMENT', quantity: -2, status: 'AVAILABLE' });
  expect(tx.productMark.updateMany).toHaveBeenCalledWith({ where: { boxId: 'a', status: 'AVAILABLE' }, data: { status: 'BLOCKED' } });
  expect(f.state.sources[0].archived).toBe(true);
});
it('includes current foreign-client content in the explicit administrative write-off snapshot', async () => {
  // TEST: user-authorized reconciliation includes actual contents in consent instead of hiding them.
  const f = fixture();
  delete f.service.previewInTx;
  const tx: any = { box: { findMany: vi.fn().mockResolvedValue([{ id: 'a', code: 'A', clientId: 'client', warehouseId: 'wh', status: 'active', storagePlacement: null, balances: [], productMarks: [{ id: 'foreign', clientId: 'other', status: 'AVAILABLE' }] }]) }, fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) } };
  (f.state.sources[0] as any).placementId = null;
  f.service.boxCodes.isPermanentStorageBox = vi.fn().mockResolvedValue(false);
  f.service.boxCodes.normalize = vi.fn(async (value: string) => value);
  const preview = await f.service.previewInTx(tx, f.state, 'missing');
  expect(preview.boxes[0].productMarks).toContainEqual(expect.objectContaining({ clientId: 'other' }));
});
it('audits administrative overrides of recount and non-FBS holds without erasing their work', async () => {
  // TEST: source row locks remain; inventory and request history are not deleted.
  const f = fixture();
  const tx: any = { $executeRaw: vi.fn(), $queryRaw: vi.fn(), inventorySession: { findFirst: vi.fn().mockResolvedValue(null) },
    inventoryAuditBox: { findFirst: vi.fn(async (q: any) => q.where.status?.in?.includes('MISMATCH') ? { id: 'audit' } : null) },
    clientRequestBoxSelection: { findFirst: vi.fn().mockResolvedValue(null) } };
  await f.service.assertMovementAllowed(tx, ['a'], f.state, f.user);
  expect(f.service.audit).toHaveBeenCalledWith(tx, f.state, f.user, 'LOCKS_OVERRIDDEN', expect.objectContaining({ recountId: 'audit' }));
  tx.inventoryAuditBox.findFirst.mockResolvedValue(null);
  tx.clientRequestBoxSelection.findFirst.mockResolvedValue({ id: 'manual-outbound' });
  await f.service.assertMovementAllowed(tx, ['a'], f.state, f.user);
  expect(f.service.audit).toHaveBeenCalledWith(tx, f.state, f.user, 'LOCKS_OVERRIDDEN', expect.objectContaining({ requestSelectionId: 'manual-outbound' }));
});

it('replays an acknowledged command without executing or saving the stock mutation again', async () => {
  // TEST: session version may have advanced after the original response was lost.
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const f = fixture();
  const user = { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' };
  const dto = { operationId: 'command', version: 1, action: 'MOVE', barcode: 'barcode', kiz: 'kiz' };
  const inputHash = createHash('sha256').update(JSON.stringify([user.id, dto])).digest('hex');
  f.state.version = 4;
  const tx = { auditLog: { findUnique: vi.fn().mockResolvedValue({ payload: { inputHash } }) } };
  f.service.prisma = { $transaction: vi.fn(async (run: any) => run(tx)) };
  f.service.load = vi.fn().mockResolvedValue(f.state);
  f.service.runAction = vi.fn(); f.service.save = vi.fn();
  expect(await f.service.action('session', dto, user)).toBe(f.state);
  expect(f.service.runAction).not.toHaveBeenCalled();
  expect(f.service.save).not.toHaveBeenCalled();
  await expect(f.service.action('session', { ...dto, barcode: 'other' }, user)).rejects.toThrow('другими данными');
});

it('rejects a stale command before stock checks or mutations', async () => {
  // TEST: another administrator cannot overwrite a newer sorting decision.
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const f = fixture(); f.state.version = 3;
  f.service.prisma = { $transaction: vi.fn(async (run: any) => run({ auditLog: { findUnique: vi.fn().mockResolvedValue(null) } })) };
  f.service.load = vi.fn().mockResolvedValue(f.state);
  f.service.assertMovementAllowed = vi.fn();
  await expect(f.service.action('session', { operationId: 'new', version: 2, action: 'COMPLETE' }, { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' })).rejects.toThrow('изменилась');
  expect(f.service.assertMovementAllowed).not.toHaveBeenCalled();
});

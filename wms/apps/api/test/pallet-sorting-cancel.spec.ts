import { afterEach, expect, it, vi } from 'vitest';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';
// TEST: cancellation must release only empty sessions, without entering stock operations.
function fixture(role = 'ADMIN') {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const state: any = { id: 'session', stage: 'CHECKING', version: 2, sources: [{ id: 'box', scanned: true, archived: false }], targets: [], moves: [], pendingRoutes: [] };
  const tx = { auditLog: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() } };
  const service: any = Object.create(PalletSortingService.prototype);
  Object.assign(service, { prisma: { $transaction: vi.fn(async (fn: any) => fn(tx)) }, load: vi.fn(async () => state), save: vi.fn(), assertMovementAllowed: vi.fn(), archiveSources: vi.fn() });
  const user = { id: 'admin', roleCodes: [role], activeWarehouseId: 'wh' };
  const dto = { action: 'CANCEL_EMPTY', version: 2, operationId: 'operation', reason: 'Открыли по ошибке' };
  return { service, state, tx, user, dto };
}
afterEach(() => vi.unstubAllEnvs());
it.each(['ADMIN', 'OWNER'])('allows %s to cancel without touching sources or stock', async role => {
  const f = fixture(role), sources = JSON.stringify(f.state.sources);
  await f.service.action('session', f.dto, f.user);
  expect(f.state.stage).toBe('COMPLETED'); expect(f.state.cancellationReason).toBe(f.dto.reason);
  expect(JSON.stringify(f.state.sources)).toBe(sources);
  expect(f.service.assertMovementAllowed).not.toHaveBeenCalled(); expect(f.service.archiveSources).not.toHaveBeenCalled();
  expect(f.tx.auditLog.create.mock.calls[0][0].data.payload.reason).toBe(f.dto.reason);
});
it.each(['OPERATOR', 'MANAGER', 'CLIENT'])('denies %s before database access', async role => {
  const f = fixture(role); await expect(f.service.action('session', f.dto, f.user)).rejects.toThrow(); expect(f.service.load).not.toHaveBeenCalled();
});
it.each([{ moves: [{}] }, { targets: [{}] }, { activeTargetId: 'target' }, { pendingRoutes: [{}] }, { sources: [{ archived: true }] }])('rejects nonempty or changed workflow %j', async patch => {
  const f = fixture(); Object.assign(f.state, patch); await expect(f.service.action('session', f.dto, f.user)).rejects.toThrow(); expect(f.service.save).not.toHaveBeenCalled();
});
it('rejects stale versions and empty reasons', async () => {
  const f = fixture(); await expect(f.service.action('session', { ...f.dto, version: 1 }, f.user)).rejects.toThrow();
  await expect(f.service.action('session', { ...f.dto, reason: ' ' }, f.user)).rejects.toThrow(); expect(f.service.save).not.toHaveBeenCalled();
});
it('replays the same operation without applying it twice', async () => {
  const f = fixture(); await f.service.action('session', f.dto, f.user);
  f.tx.auditLog.findUnique.mockResolvedValue(f.tx.auditLog.create.mock.calls[0][0].data);
  await f.service.action('session', f.dto, f.user); expect(f.service.save).toHaveBeenCalledTimes(1);
});
it('honors installation flag and branch scope', async () => {
  const f = fixture(); vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'false'); await expect(f.service.action('session', f.dto, f.user)).rejects.toThrow();
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true'); f.service.load.mockRejectedValue(new Error('foreign branch')); await expect(f.service.action('session', f.dto, f.user)).rejects.toThrow('foreign branch'); expect(f.service.save).not.toHaveBeenCalled();
});

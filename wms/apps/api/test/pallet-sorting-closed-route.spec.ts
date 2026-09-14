import {afterEach, expect, it, vi} from 'vitest';
import {MarketplaceConnectionsService} from '../src/modules/marketplace-connections/marketplace-connections.service';
import {PalletSortingService} from '../src/modules/inventory/pallet-sorting.service';

afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
  const request: any = {id: 'r', number: 905, type: 'OUTBOUND', status: 'DONE', clientId: 'c', warehouseId: 'w', fbsOrderLinks: [{orderId: 'order'}]};
  const task: any = {id: 't', requestId: 'r', clientId: 'c', status: 'RESERVED', boxId: null, reservedBoxId: 'source', barcode: null, kiz: null, sourceBarcode: null, relabelConfirmedAt: null, updatedAt: new Date()};
  const db: any = {clientRequest: {findUnique: vi.fn().mockResolvedValue(request)},
    fbsTsdAssembly: {findMany: vi.fn().mockResolvedValue([task]), updateMany: vi.fn().mockResolvedValue({count: 1})},
    stockMovement: {findFirst: vi.fn().mockResolvedValue(null), create: vi.fn()}};
  const service: any = Object.create(MarketplaceConnectionsService.prototype);
  service.prisma = db; service.clientScopes = {requireClientAccess: vi.fn()};
  const sorting: any = Object.create(PalletSortingService.prototype); sorting.audit = vi.fn();
  const state: any = {id: 'session', clientId: 'c', warehouseId: 'w', version: 24, pendingRoutes: []};
  return {service, sorting, db, request, task, state, user: {id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'w'}};
}

it.each(['DONE', 'CANCELLED', 'REJECTED'])('does not invalidate a source reservation of a %s request', async status => {
  // TEST: scanning PL27 used to reset a task of closed request 905 and enqueue an impossible repair.
  const f = fixture(); f.request.status = status;
  const before = structuredClone(f.task);
  await f.sorting.resetAffectedRoutes(f.db, f.state, ['source'], f.user);
  expect(f.task).toEqual(before);
  expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  expect(f.state.pendingRoutes).toEqual([]);
});

it('still invalidates an active logical reservation', async () => {
  const f = fixture(); f.request.status = 'IN_WORK';
  await f.sorting.resetAffectedRoutes(f.db, f.state, ['source'], f.user);
  expect(f.db.fbsTsdAssembly.updateMany).toHaveBeenCalledOnce();
  expect(f.state.pendingRoutes).toEqual([{requestId: 'r', taskIds: ['t'], revision: 25, clientId: 'c', warehouseId: 'w'}]);
});

it.each(['DONE', 'CANCELLED', 'REJECTED'])('finishes an exact sorting retry for %s without touching physical history', async status => {
  // TEST: even remaining WB confirm links cannot make a closed request routable.
  const f = fixture(); f.request.status = status;
  f.task.status = 'COMPLETED'; f.task.kiz = 'physical-kiz'; f.task.barcode = 'physical-barcode';
  const before = structuredClone(f.task);
  const result = await f.service.repairFbsRequestSelection('r', f.user, ['t', 't']);
  expect(result.skippedTaskIds).toEqual(['t']);
  expect(f.task).toEqual(before);
  expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  expect(f.db.stockMovement.create).not.toHaveBeenCalled();
});

it.each(['missing-task', 'foreign-client', 'foreign-request', 'wrong-id', 'wrong-warehouse', 'denied-client', 'non-outbound', 'non-admin', 'disabled', 'empty'])('keeps closed-route validation for %s', async kind => {
  const f = fixture();
  if (kind === 'missing-task') f.db.fbsTsdAssembly.findMany.mockResolvedValue([]);
  if (kind === 'foreign-client') f.task.clientId = 'other';
  if (kind === 'foreign-request') f.task.requestId = 'other';
  if (kind === 'wrong-id') f.task.id = 'other';
  if (kind === 'wrong-warehouse') f.request.warehouseId = 'other';
  if (kind === 'denied-client') f.service.clientScopes.requireClientAccess.mockImplementation(() => {throw new Error('denied');});
  if (kind === 'non-outbound') f.request.type = 'SKU_COLLECTION';
  if (kind === 'non-admin') f.user.roleCodes = ['WORKER'];
  if (kind === 'disabled') vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'false');
  await expect(f.service.repairFbsRequestSelection('r', f.user, kind === 'empty' ? [] : ['t'])).rejects.toThrow();
  expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
});

it('still rejects ordinary whole-request repair of a closed request', async () => {
  const f = fixture();
  await expect(f.service.repairFbsRequestSelection('r', f.user)).rejects.toThrow('Закрытую FBS-заявку');
});

it.each([false, true])('clears the closed retry without losing a newer sorting revision: %s', async concurrent => {
  // TEST: clearing retry state cannot overwrite box moves or a concurrent new retry.
  const f = fixture();
  f.state.pendingRoutes = [{requestId: 'r', taskIds: ['t'], revision: 14, error: 'Закрытую FBS-заявку нельзя пересчитать.'}];
  const current = structuredClone(f.state);
  current.moves = [{sourceBoxId: 'source', targetBoxId: 'target', quantity: 1}];
  if (concurrent) {current.pendingRoutes[0].revision++; current.pendingRoutes[0].taskIds.push('new-task');}
  f.sorting.marketplace = f.service;
  f.sorting.prisma = {$transaction: vi.fn(async (run: any) => run({}))};
  f.sorting.get = vi.fn().mockResolvedValueOnce(f.state).mockImplementation(async () => current);
  f.sorting.load = vi.fn().mockResolvedValue(current); f.sorting.save = vi.fn();
  const result = await f.sorting.rebuildRoutes('session', f.user);
  expect(result.moves).toEqual([{sourceBoxId: 'source', targetBoxId: 'target', quantity: 1}]);
  if (concurrent) {expect(result.pendingRoutes[0].taskIds).toEqual(['t', 'new-task']); expect(f.sorting.save).not.toHaveBeenCalled();}
  else {expect(result.pendingRoutes).toEqual([]); expect(result.version).toBe(25);}
  expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  expect(f.db.stockMovement.create).not.toHaveBeenCalled();
});

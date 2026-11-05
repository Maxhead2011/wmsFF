import 'reflect-metadata';
import { ROUTE_ARGS_METADATA, PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TsdDeviceController } from '../src/modules/tsd/tsd-device.controller';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

const confirmation = vi.hoisted(() => vi.fn().mockResolvedValue({ cutUnits: 2, cutMm: 6000, replay: false }));
vi.mock('../src/modules/warehouse/fabric-fbs-confirmation', () => ({ confirmFabricProduction: confirmation }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

function fixture() {
  vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true');
  const user: any = { id: 'worker', deviceCode: 'terminal', activeWarehouseId: 'warehouse', tsdFabricCutConfirmation: true };
  const task = { id: 'task', clientId: 'client', marketplace: 'OZON', connectionId: 'connection', orderId: 'order', requestId: 'request' };
  const tx = { $queryRaw: vi.fn(), clientRequest: { findUnique: vi.fn().mockResolvedValue({ warehouseId: 'warehouse' }) } };
  const service: any = Object.create(MarketplaceConnectionsService.prototype);
  service.prisma = { $transaction: (fn: any) => fn(tx) };
  service.loadOwnedFbsTsdAssembly = vi.fn().mockResolvedValue(task);
  service.requireCurrentFbsTsdLease = vi.fn();
  service.fbsTsdDeviceCode = () => 'terminal';
  service.inventoryLock = { assertStockMovementsAllowed: vi.fn() };
  return { service, user, task, tx, body: { lineId: 'line', confirmedUnits: 2, operationId: 'stable-retry-id' } };
}
describe('fabric confirmation API boundary', () => {
  // TEST: verify the real Nest endpoint metadata and capability parameter factory.
  it('uses a separate POST route and forwards capability without altering identity', () => {
    const handler = TsdDeviceController.prototype.confirmFbsFabricCut;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('fbs/tasks/:id/confirm-fabric-cut');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    const args = Object.values(Reflect.getMetadata(ROUTE_ARGS_METADATA, TsdDeviceController, 'confirmFbsFabricCut')) as any[];
    const resolve = args.find(a => a.factory).factory;
    const user = { id: 'worker' };
    const result = resolve(undefined, { switchToHttp: () => ({ getRequest: () => ({ user,
      headers: { 'x-tsd-fabric-capability': 'fabric-cut-v1', 'x-tsd-fbs-capability': 'physical-pick-v1' } }) }) });
    expect(result).toEqual({ id: 'worker', tsdPhysicalPickConfirmation: true, tsdFabricCutConfirmation: true });
    expect(user).toEqual({ id: 'worker' });
  });
  it('derives client and order ownership from the task, not caller input', async () => {
    const f = fixture();
    await f.service.confirmFbsTsdFabricCut('task', { ...f.body, clientId: 'foreign', orderId: 'foreign' }, f.user);
    expect(confirmation).toHaveBeenCalledWith(f.tx, expect.objectContaining({ clientId: 'client',
      owner: { marketplace: 'OZON', connectionId: 'connection', orderId: 'order', requestId: 'request' } }),
    { userId: 'worker', deviceCode: 'terminal' }, expect.any(Function));
  });
  it('checks the inventory lock before any production transaction', async () => {
    const f = fixture(); f.service.inventoryLock.assertStockMovementsAllowed.mockRejectedValue(new Error('Inventory locked'));
    await expect(f.service.confirmFbsTsdFabricCut('task', f.body, f.user)).rejects.toThrow('Inventory locked');
    expect(confirmation).not.toHaveBeenCalled();
  });
  it('rejects a different active branch', async () => {
    const f = fixture(); f.user.activeWarehouseId = 'other';
    await expect(f.service.confirmFbsTsdFabricCut('task', f.body, f.user)).rejects.toThrow('филиал');
    expect(confirmation).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, '2', undefined])('rejects invalid absolute quantity %s', async confirmedUnits => {
    const f = fixture();
    await expect(f.service.confirmFbsTsdFabricCut('task', { ...f.body, confirmedUnits }, f.user)).rejects.toThrow('количество');
    expect(confirmation).not.toHaveBeenCalled();
  });
  it('rejects old terminals and disabled installations', async () => {
    const f = fixture();
    await expect(f.service.confirmFbsTsdFabricCut('task', f.body, { ...f.user, tsdFabricCutConfirmation: false })).rejects.toThrow('не включена');
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'false');
    await expect(f.service.confirmFbsTsdFabricCut('task', f.body, f.user)).rejects.toThrow('не включена');
    expect(confirmation).not.toHaveBeenCalled();
  });
});

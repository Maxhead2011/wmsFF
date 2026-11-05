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
  service.formatFbsTsdAssembly = vi.fn().mockResolvedValue({ state: 'SCAN_BARCODE', task });
  service.inventoryLock = { assertStockMovementsAllowed: vi.fn() };
  return { service, user, task, tx, body: { lineId: 'line', confirmedUnits: 2, operationId: 'stable-retry-id' } };
}
describe('fabric confirmation API boundary', () => {
  // TEST: the new fabric hook must preserve ordinary already-accepted scan retries.
  it('preserves a normal accepted WB scan response without revalidating the payload',async()=>{
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED','false');
    const task={id:'ordinary',marketplace:'WILDBERRIES',status:'IN_PROGRESS',boxId:'box',barcode:'1234567890123'};
    const service:any=Object.create(MarketplaceConnectionsService.prototype);
    service.loadOwnedFbsTsdAssembly=vi.fn().mockResolvedValue(task);
    service.requireFbsOrderStillCollectable=vi.fn();
    service.assertFbsTsdLeaseVersion=vi.fn().mockResolvedValue(task);
    service.formatFbsTsdAssembly=vi.fn().mockResolvedValue({state:'READY_TO_COMPLETE'});
    await expect(service.scanFbsTsdBarcode(task.id,{},{})).resolves.toEqual({state:'READY_TO_COMPLETE'});
  });
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
  // TEST: legacy clients cannot debit metres through the abandoned separate button.
  it.each(['true','false'])('rejects separate cut confirmation without any mutation, enabled=%s',async enabled=>{
    const f=fixture();vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED',enabled);
    await expect(f.service.confirmFbsTsdFabricCut('task',f.body,f.user)).rejects.toThrow('Отсканируйте ШК');
    expect(confirmation).not.toHaveBeenCalled();
    expect(f.service.loadOwnedFbsTsdAssembly).not.toHaveBeenCalled();
  });
});

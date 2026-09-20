import { afterEach, expect, it, vi } from 'vitest';
import { confirmFbsPickedManagerDecision } from '../src/modules/marketplace-connections/fbs-manager-decision';
import { FbsPickedDisposition, FbsSyncConflictResolutionAction } from '../src/modules/marketplace-connections/dto/resolve-fbs-sync-conflict.dto';
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'true');
  const task: any = { id: 'task', requestId: 'request', clientId: 'client', orderId: '5806766339', status: 'RETURN_REQUIRED', updatedAt: new Date(0), completedAt: new Date(0), kiz: 'kiz', barcode: 'barcode', skuId: 'sku', itemCount: 1 };
  const link: any = { id: 'link', requestId: 'request', syncStatus: 'ACTIVE', lastCategory: 'shipped', lastSupplierStatus: 'complete', lastWbStatus: 'waiting', lastSkuId: 'sku', lastItemCount: 1 };
  const tx: any = { fbsTsdAssembly: { findUnique: vi.fn(async()=>task), update: vi.fn() }, fbsOrderRequestLink: { findUnique: vi.fn(async()=>link), update: vi.fn() }, clientRequest: { findUnique: vi.fn(async()=>({clientId:'client',warehouseId:'wh',status:'IN_WORK'})) }, auditLog: { findFirst: vi.fn(async()=>null), create: vi.fn() }, clientRequestEvent: { create: vi.fn() } };
  const run = () => confirmFbsPickedManagerDecision({$transaction: (fn:any)=>fn(tx)} as any, {...task}, {...link}, {action:FbsSyncConflictResolutionAction.MANAGER_CONFIRMED,pickedDisposition:FbsPickedDisposition.SHIP_WITH_WB_LABEL,comment:'ушло'}, {id:'owner',activeWarehouseId:'wh',permissionCodes:['system:admin']} as any);
  return {task,link,tx,run};
}
// TEST: real mismatch observed on request 1121; no stock APIs exist in this fixture.
it('accepts shipment for a picked return with a recovered active WB link', async()=>{
 const f=fixture(); await expect(f.run()).resolves.toMatchObject({resolved:true});
 expect(f.tx.fbsTsdAssembly.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'COMPLETED'})}));
 expect(f.tx.fbsOrderRequestLink.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({syncStatus:'MANAGER_CONFIRMED_SHIPMENT'})}));
});
it.each(['MOVING','MANAGER_CONFIRMED_RETURN'])('rejects incompatible link %s',async status=>{const f=fixture();f.link.syncStatus=status;await expect(f.run()).rejects.toThrow();expect(f.tx.auditLog.create).not.toHaveBeenCalled();});
it('keeps the feature disabled for sold WMS',async()=>{const f=fixture();vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED','false');await expect(f.run()).rejects.toThrow();});
it('rejects an active link with changed SKU',async()=>{const f=fixture();f.link.lastSkuId='other';await expect(f.run()).rejects.toThrow();});

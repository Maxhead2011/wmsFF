import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkuSortingService } from '../src/modules/inventory/sku-sorting.service';
import { SkuCollectionService } from '../src/modules/inventory/sku-collection.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';

afterEach(() => vi.unstubAllEnvs());
// TEST: cancellation is a workflow transition; no physical pick/receipt is fabricated.
function fixture() {
  vi.stubEnv('WMS_SKU_SORTING_ENABLED', 'true');
  vi.stubEnv('WMS_SKU_COLLECTION_CANCEL_ENABLED', 'true');
  const user: any = { id: 'worker', name: 'Worker', permissionCodes: ['stock:write'], roleCodes: ['WAREHOUSE'],
    activeWarehouseId: 'warehouse', warehouseIds: ['warehouse'], writableWarehouseIds: ['warehouse'], clientIds: ['client'], writableClientIds: ['client'] };
  const request: any = { id: 'collection', type: 'SKU_COLLECTION', number: 42, clientId: 'client', warehouseId: 'warehouse',
    status: 'IN_WORK', comment: '[SKU_SORTING_V2]', skuCollectionSources: [{ id: 'source', sourceBoxId: 'box', sourceBoxCode: 'BOX', skuId: 'sku', plannedQuantity: 5, pickedQuantity: 2, receivedQuantity: 2 }] };
  const tx: any = { $queryRaw: vi.fn(),
    clientRequest: { findFirst: vi.fn(async ({where}: any) => where.status.in.includes(request.status) && where.type===request.type ? request : null),
      update: vi.fn(async ({data}: any) => Object.assign(request, data)), findMany: vi.fn(async ({where}: any) => where.status.in.includes(request.status) ? [request] : []) },
    skuCollectionScan: { count: vi.fn(async () => 0) },
    inventoryAuditBox: { findFirst: vi.fn(async () => null) }, inventorySession: { findFirst: vi.fn(async () => null) },
    stockBalance: { findMany: vi.fn(async () => [{id:'reserve',quantity:3,palletId:'pallet'}]), delete: vi.fn(), upsert: vi.fn() },
    stockMovement: { aggregate: vi.fn(async () => ({_sum:{quantity:5}})), createMany: vi.fn() },
    productMark: { updateMany: vi.fn() }, fbsTsdAssembly: { findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn() }, clientRequestEvent: { create: vi.fn() },
  };
  const db: any = { ...tx, $transaction: vi.fn(async (fn: any) => {
    const before = structuredClone(request);
    try { return await fn(tx); } catch (error) { Object.keys(request).forEach(k=>delete request[k]);Object.assign(request,before);throw error; }
  }) };
  const scopes = new ClientScopeService();
  const collections = new SkuCollectionService(db, scopes, {} as any);
  const service: any = new SkuSortingService(db, scopes, {balanceKey:()=> 'available'} as any, collections, {} as any, {} as any);
  return {service,collections,db,tx,user,request,run:()=>service.cancel('collection',user)};
}

describe('cancel SKU collection from WMS', () => {
  // TEST: our production keeps global sorting disabled; removing a task must not enable it.
  it('cancels a legacy task with only the dedicated cancellation flag enabled', async () => {
    const f = fixture();
    vi.stubEnv('WMS_SKU_SORTING_ENABLED', 'false');
    f.request.comment = '[SKU_COLLECTION]';
    expect(f.service.cancelCapabilities(f.user)).toEqual({ canCancel: true });
    await f.run();
    expect(f.request.status).toBe('CANCELLED');
    expect(f.tx.stockBalance.delete).toHaveBeenCalledOnce();
  });
  it('removes a partially sorted task from the TSD queue and preserves physical stock', async () => {
    const f=fixture();await f.run();
    expect(f.request.status).toBe('CANCELLED');
    expect(await f.collections.list(f.user)).toEqual([]);
    expect(f.tx.stockBalance.delete).not.toHaveBeenCalled();expect(f.tx.stockMovement.createMany).not.toHaveBeenCalled();expect(f.tx.productMark.updateMany).not.toHaveBeenCalled();
    expect(f.request.skuCollectionSources[0]).toMatchObject({pickedQuantity:2,receivedQuantity:2});
    expect(f.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:'SKU_COLLECTION_CANCELLED',entityId:'collection',userId:'worker'})}));
    expect(f.tx.clientRequestEvent.create).toHaveBeenCalledOnce();
    expect(f.tx.clientRequestEvent.create.mock.calls[0][0].data).toMatchObject({statusFrom:'IN_WORK',statusTo:'CANCELLED'});
  });
  it('releases only unused provable legacy reserves and records both ledger legs', async () => {
    const f=fixture();f.request.comment='[SKU_COLLECTION]';await f.run();
    expect(f.tx.stockBalance.upsert.mock.calls[0][0].create).toMatchObject({status:'AVAILABLE',quantity:3,boxId:'box'});
    expect(f.tx.stockMovement.createMany.mock.calls[0][0].data.map((row:any)=>row.quantity)).toEqual([-3,3]);
    expect(f.tx.productMark.updateMany.mock.calls[0][0].where.status).toBe('RESERVED');
  });
  it('does not duplicate audit or release on retry', async () => {
    const f=fixture();f.request.comment='[SKU_COLLECTION]';await f.run();await f.run();
    expect(f.tx.auditLog.create).toHaveBeenCalledOnce();expect(f.tx.stockBalance.delete).toHaveBeenCalledOnce();
  });
  it.each(['counter','scan'])('blocks removal with unreceived physical picks: %s', async kind => {
    const f=fixture();if(kind==='counter')f.request.skuCollectionSources[0].receivedQuantity=1;else f.tx.skuCollectionScan.count.mockResolvedValue(1);
    await expect(f.run()).rejects.toThrow(/при[её]м|размест/);expect(f.request.status).toBe('IN_WORK');expect(f.tx.stockBalance.delete).not.toHaveBeenCalled();
  });
  it.each(['reserve','fbs','counting','full-inventory'])('blocks unsafe legacy cancellation: %s', async kind => {
    const f=fixture();f.request.comment='[SKU_COLLECTION]';
    if(kind==='reserve')f.tx.stockBalance.findMany.mockResolvedValue([{id:'reserve',quantity:4}]);
    if(kind==='fbs')f.tx.fbsTsdAssembly.findFirst.mockResolvedValue({id:'fbs'});
    if(kind==='counting')f.tx.inventoryAuditBox.findFirst.mockResolvedValue({id:'count'});
    if(kind==='full-inventory')f.tx.inventorySession.findFirst.mockResolvedValue({id:'inventory'});
    await expect(f.run()).rejects.toThrow();expect(f.request.status).toBe('IN_WORK');expect(f.tx.stockBalance.delete).not.toHaveBeenCalled();
  });
  it.each(['flag','demo','client-role','read-only','client-scope','warehouse'])('rejects outside authorized scope: %s', async kind => {
    const f=fixture();
    if(kind==='flag')vi.stubEnv('WMS_SKU_COLLECTION_CANCEL_ENABLED','false');
    if(kind==='demo')f.user.isDemo=true;if(kind==='client-role')f.user.roleCodes=['CLIENT'];if(kind==='read-only')f.user.permissionCodes=['stock:read'];
    if(kind==='client-scope')f.user.writableClientIds=[];if(kind==='warehouse')f.user.activeWarehouseId='other';
    await expect(f.run()).rejects.toThrow();expect(f.tx.clientRequest.update).not.toHaveBeenCalled();expect(f.tx.stockBalance.delete).not.toHaveBeenCalled();
  });
  it.each(['DONE','REJECTED'])('does not change terminal status %s', async status => {
    const f=fixture();f.request.status=status;await expect(f.run()).rejects.toThrow();expect(f.tx.clientRequest.update).not.toHaveBeenCalled();
  });
  it('rejects a different request type', async () => {
    const f=fixture();f.request.type='OUTBOUND';await expect(f.run()).rejects.toThrow();expect(f.tx.clientRequest.update).not.toHaveBeenCalled();
  });
  it('prevents a stale TSD from restarting or picking a cancelled task', async () => {
    const f=fixture();await f.run();
    await expect(f.service.start('collection',f.user)).rejects.toThrow();
    await expect(f.collections.pick('collection',{sourceBoxCode:'BOX',barcode:'001',kiz:'mark'},f.user)).rejects.toThrow();
    expect(f.request.status).toBe('CANCELLED');
  });
  it('rolls back cancellation if the audit fails', async () => {
    const f=fixture();f.tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(f.run()).rejects.toThrow('audit unavailable');expect(f.request.status).toBe('IN_WORK');
  });
});

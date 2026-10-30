import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {assertClientKizUse, decideClientKizReview, clientUseContext, clientUseTaskKey, withClientKizReview} from '../src/common/kiz-client-review';

// TEST: physical availability must not grant a second shipment after historical dispatch.
const kiz='010460000000000121ABCDEFGHIJKLM';
const input:any={scope:'FBO',clientId:'client',warehouseId:'wh',requestId:'request',skuId:'sku',boxId:'box',kiz};
const user:any={id:'admin',name:'Admin',roleCodes:['ADMIN'],permissionCodes:['system:admin'],activeWarehouseId:'wh'};
function fixture(){
 const mark={id:'mark',clientId:'client',skuId:'sku',boxId:'box',value:kiz,status:'AVAILABLE',updatedAt:new Date('2026-10-29T10:00:00Z'),box:{id:'box',clientId:'client',warehouseId:'wh',status:'active'},sku:{name:'Suit'}};
 let row:any=null;
 const db:any={
  $queryRaw:vi.fn(async()=>[]),$executeRaw:vi.fn(async()=>1),
  productMark:{findMany:vi.fn(async()=>[mark])},
  shippedKizHistory:{findMany:vi.fn(async()=>[{id:'shipment',clientId:'client',requestId:'old',kiz,shippedAt:new Date('2026-10-01'),requestNumber:1,productName:'Suit'}])},
  fboAssemblyUnit:{findMany:vi.fn(async()=>[])}, fbsTsdAssembly:{findMany:vi.fn(async()=>[]),findUnique:vi.fn()},
  clientRequest:{findUnique:vi.fn(async()=>({id:'request',clientId:'client',warehouseId:'wh',number:2,status:'IN_PROGRESS'}))},
  box:{findUnique:vi.fn(async()=>mark.box)},
  kizReviewCase:{findUnique:vi.fn(async()=>row),findMany:vi.fn(async()=>[]),update:vi.fn(async({data}:any)=>row={...row,...data}),upsert:vi.fn(async({create,update}:any)=>row=row?{...row,...update}:{id:'review',...create})},
  auditLog:{create:vi.fn(async()=>({}))},
 };
 db.$transaction=async(fn:any)=>fn(db);
 return {db,mark,getRow:()=>row,setRow:(r:any)=>row=r};
}
beforeEach(()=>vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true'));
afterEach(()=>vi.unstubAllEnvs());
it('blocks an available previously shipped unit and persists its case after rejected transaction',async()=>{
 const f=fixture();await expect(withClientKizReview(f.db,user,()=>assertClientKizUse(f.db,input,user))).rejects.toThrow('ОТЛОЖИТЕ');
 expect(f.getRow()).toMatchObject({status:'OPEN',clientId:'client',taskId:clientUseTaskKey(input)});
 expect(f.db.productMark.findMany.mock.calls[0][0].where.clientId).toBe('client');
});
it('does not query history when our installation flag is disabled',async()=>{
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','false');const f=fixture();await assertClientKizUse(f.db,input,user);
 expect(f.db.shippedKizHistory.findMany).not.toHaveBeenCalled();
});
it('claims a first shipment without manufacturing an administrative approval',async()=>{
 const f=fixture();f.db.shippedKizHistory.findMany.mockResolvedValue([]);await assertClientKizUse(f.db,input,user);
 expect(f.getRow()).toMatchObject({status:'CLAIMED',resolution:'FIRST_USE'});expect(f.getRow().decidedById).toBeUndefined();
 await assertClientKizUse(f.db,input,user);
});
it('allows a legacy first shipment prepared in SHIPPING without treating packing as prior shipment',async()=>{
 const f=fixture();f.mark.status='SHIPPING';f.db.shippedKizHistory.findMany.mockResolvedValue([]);
 await assertClientKizUse(f.db,input,user);expect(f.getRow()).toMatchObject({status:'CLAIMED',resolution:'FIRST_USE'});
});
it('blocks a competing first use before any marketplace write',async()=>{
 const f=fixture();f.db.shippedKizHistory.findMany.mockResolvedValue([]);
 f.db.kizReviewCase.findMany.mockResolvedValue([{id:'other',requestId:'other',resolution:'FIRST_USE'}]);
 await expect(assertClientKizUse(f.db,input,user)).rejects.toThrow('другой сборкой');
 expect(f.db.kizReviewCase.upsert).not.toHaveBeenCalled();
});
it('requires a real administrator and rejects an automatic approval',async()=>{
 const f=fixture();await expect(withClientKizReview(f.db,user,()=>assertClientKizUse(f.db,input,user))).rejects.toThrow();
 await expect(decideClientKizReview(f.db,{requireClientAccess:vi.fn()},f.getRow(),'REUSE','physical confirmed',true,{...user,roleCodes:['WORKER']})).rejects.toThrow('администратор');
 f.setRow({...f.getRow(),status:'APPROVED',resolution:'REUSE',decidedById:null,reason:'automatic'});
 await expect(assertClientKizUse(f.db,input,user)).rejects.toThrow('ОТЛОЖИТЕ');
});
it('uses explicit approval once for its context and allows the same-operation retry',async()=>{
 const f=fixture();await expect(withClientKizReview(f.db,user,()=>assertClientKizUse(f.db,input,user))).rejects.toThrow();
 await decideClientKizReview(f.db,{requireClientAccess:vi.fn()},f.getRow(),'REUSE','physical confirmed',true,user);
 await assertClientKizUse(f.db,input,user);expect(f.getRow().status).toBe('CLAIMED');
 await assertClientKizUse(f.db,input,user);
 await expect(assertClientKizUse(f.db,{...input,requestId:'another'},user)).rejects.toThrow();
});
it('invalidates the approval after mark movement and keeps rejected cases blocked',async()=>{
 const f=fixture();await expect(withClientKizReview(f.db,user,()=>assertClientKizUse(f.db,input,user))).rejects.toThrow();
 await decideClientKizReview(f.db,{requireClientAccess:vi.fn()},f.getRow(),'REUSE','physical confirmed',true,user);
 f.mark.updatedAt=new Date('2026-10-29T11:00:00Z');await expect(assertClientKizUse(f.db,input,user)).rejects.toThrow();
 f.setRow({...f.getRow(),status:'REJECTED',resolution:'REJECT'});await expect(assertClientKizUse(f.db,input,user)).rejects.toThrow();
});
it('binds context to client, request, SKU and source box',()=>{
 for(const change of [{clientId:'other'},{requestId:'other'},{skuId:'other'},{boxId:'other'}])expect(clientUseContext({...input,...change})).not.toBe(clientUseContext(input));
});
// TEST: shipment in the same request is still history for a different order.
it('blocks the second order in the same request after the first has shipped',async()=>{
 const f=fixture(),i={...input,scope:'FBS',taskId:'second'};
 f.db.fbsTsdAssembly.findUnique.mockResolvedValue({id:'second',clientId:i.clientId,requestId:i.requestId,skuId:i.skuId,boxId:i.boxId});
 f.db.shippedKizHistory.findMany.mockImplementation(async({where}:any)=>where.requestId?.not===i.requestId?[]:[{id:'firstship',assemblyId:'first',clientId:i.clientId,requestId:i.requestId,kiz}]);
 await expect(assertClientKizUse(f.db,i,user)).rejects.toThrow('ОТЛОЖИТЕ');
 expect(f.db.kizReviewCase.upsert).not.toHaveBeenCalled();
});
it('does not accept an unrelated mark change in the same source box',async()=>{
 const f=fixture(),i={...input,scope:'FBS',taskId:'task'};
 f.db.fbsTsdAssembly.findUnique.mockResolvedValue({id:'task',clientId:i.clientId,requestId:i.requestId,skuId:i.skuId,boxId:i.boxId,kiz});
 f.db.shippedKizHistory.findMany.mockResolvedValue([]);await assertClientKizUse(f.db,i,user);
 f.mark.updatedAt=new Date('2026-10-29T11:00:00Z');
 await expect(assertClientKizUse(f.db,i,user)).rejects.toThrow('ОТЛОЖИТЕ');
});
it('queues ambiguous client marks without merging them and allows administrator refusal',async()=>{
 const f=fixture();f.db.productMark.findMany.mockResolvedValue([f.mark,{...f.mark,id:'other'}]);
 await expect(withClientKizReview(f.db,user,()=>assertClientKizUse(f.db,input,user))).rejects.toThrow('ОТЛОЖИТЕ');
 expect(f.getRow().status).toBe('OPEN');
 await decideClientKizReview(f.db,{requireClientAccess:vi.fn()},f.getRow(),'REJECT','duplicate requires reconciliation',true,user);
 expect(f.getRow().status).toBe('REJECTED');
});
// TEST: WB moves the accepted mark to PACKING without changing stockMovementId.
it('allows retry after the exact current order pick into packing without a source box',async()=>{
 const f=fixture(),i={...input,scope:'FBS',taskId:'task'};
 f.db.fbsTsdAssembly.findUnique.mockResolvedValue({id:'task',clientId:i.clientId,requestId:i.requestId,skuId:i.skuId,boxId:i.boxId,kiz,wbMetaStatus:'ACCEPTED',stockWarehouseId:'wh',itemCount:1});
 f.db.shippedKizHistory.findMany.mockResolvedValue([]);await assertClientKizUse(f.db,i,user);
 f.mark.status='PACKING';f.mark.boxId=null as any;f.mark.updatedAt=new Date('2026-10-30');
 f.db.stockMovement={findMany:vi.fn(async()=>[{quantity:1}])};
 await expect(assertClientKizUse(f.db,i,user)).resolves.toBe('ALLOW');
 expect(f.db.stockMovement.findMany.mock.calls[0][0].where).toMatchObject({clientId:'client',warehouseId:'wh',sourceDocument:'request',skuId:'sku',boxId:null,status:'PACKING',idempotencyKey:{startsWith:'fbs-sticker-pick:task:'}});
 f.db.stockMovement.findMany.mockResolvedValue([{quantity:1},{quantity:-1}]);
 await expect(assertClientKizUse(f.db,i,user)).rejects.toThrow();
});
it('never silently promotes an open review when a later history lookup is empty',async()=>{
 const f=fixture();await expect(withClientKizReview(f.db,user,()=>assertClientKizUse(f.db,input,user))).rejects.toThrow();
 f.db.shippedKizHistory.findMany.mockResolvedValue([]);
 await expect(assertClientKizUse(f.db,input,user)).rejects.toThrow();
 expect(f.getRow().status).toBe('OPEN');
});
it('includes confirmed shipment date and previous order in the refusal',async()=>{
 const f=fixture();f.db.shippedKizHistory.findMany.mockResolvedValue([{id:'old',kiz,orderId:'123456',requestNumber:99,shippedAt:new Date('2026-10-01T10:00:00Z')}]);
 await expect(assertClientKizUse(f.db,input,user)).rejects.toThrow(/01\.10\.2026.*123456/);
});

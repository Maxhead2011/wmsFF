import {afterEach,expect,it,vi} from 'vitest';
import {assertClientRequestKizShipment,ClientKizReviewRequired} from '../src/common/kiz-client-review';
const request={id:'r',clientId:'c',warehouseId:'w',status:'IN_WORK'};
const code=(n:number)=>'010460000000000121'+String(n).padStart(13,'A');
function fixture(count=578){
 const units=Array.from({length:count},(_,n)=>({id:'u'+n,requestId:'r',kiz:code(n),skuId:'s',sourceBoxId:'source',targetBoxId:'target',markId:'m'+n,state:'PACKED'}));
 const marks=units.map(u=>({id:u.markId,clientId:'c',skuId:'s',value:u.kiz,boxId:'target',status:'PACKING',updatedAt:new Date(),box:{code:'target'}}));
 const db:any={$queryRaw:vi.fn(async()=>[]),$executeRaw:vi.fn(async()=>1),clientRequest:{findUnique:vi.fn(async()=>request)},
 fboAssemblyUnit:{findMany:vi.fn(async({where}:any)=>where.requestId==='r'?(where.markId?units.filter(u=>u.markId===where.markId):units):[])},
 productMark:{findMany:vi.fn(async({where}:any)=>marks.filter(m=>JSON.stringify(where).includes(m.value)))},
 shippedKizHistory:{findMany:vi.fn(async()=>[])},fbsTsdAssembly:{findMany:vi.fn(async()=>[])},
 kizReviewCase:{findMany:vi.fn(async()=>[]),findUnique:vi.fn(async()=>null),upsert:vi.fn(async()=>({})),update:vi.fn()},auditLog:{create:vi.fn()}};
 return {db,units,marks};
}
afterEach(()=>vi.unstubAllEnvs());
// TEST: 578-unit finish must not repeat the physical-mark scan for each unit.
it('bounds database mark reads for a 578-unit FBO shipment without dropping claims',async()=>{
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');const {db}=fixture();await assertClientRequestKizShipment(db,request,{id:'worker'});
 expect(db.productMark.findMany.mock.calls.length).toBeLessThanOrEqual(30);expect(db.kizReviewCase.upsert).toHaveBeenCalledTimes(578);
});
it('keeps real duplicate physical marks on review',async()=>{
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');const {db,marks}=fixture(2);marks.push({...marks[0],id:'duplicate'});
 await expect(assertClientRequestKizShipment(db,request,{id:'worker'})).rejects.toBeInstanceOf(ClientKizReviewRequired);
});
it('does not read or mutate anything on sold installations with the guard disabled',async()=>{
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','false');const {db}=fixture();await assertClientRequestKizShipment(db,request,{});expect(db.fboAssemblyUnit.findMany).not.toHaveBeenCalled();
});
// TEST: batch inputs keep all negative decisions from the single-KIZ policy.
it.each(['OPEN','REJECTED','USED'])('does not bypass an existing %s review',async status=>{
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');const {db}=fixture(1);
 db.kizReviewCase.findMany.mockResolvedValue([{id:'review',taskId:'GUARD:FBO:c:r',kizIdentity:code(0),status,resolution:'FIRST_USE'}]);
 await expect(assertClientRequestKizShipment(db,request,{id:'worker'})).rejects.toBeInstanceOf(ClientKizReviewRequired);
 expect(db.kizReviewCase.upsert).not.toHaveBeenCalled();
});
it('blocks historical shipment with date and order even when current mark is PACKING',async()=>{
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');const {db}=fixture(1);
 db.shippedKizHistory.findMany.mockResolvedValue([{id:'history',kiz:code(0),shippedAt:new Date('2026-10-01'),requestId:'old',orderId:'WB-123',warehouseId:'w'}]);
 await expect(assertClientRequestKizShipment(db,request,{id:'worker'})).rejects.toThrow('WB-123');
});
it('blocks duplicates inside the current request before creating any claim',async()=>{
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');const {db,units}=fixture(2);units[1].kiz=units[0].kiz;
 await expect(assertClientRequestKizShipment(db,request,{id:'worker'})).rejects.toBeInstanceOf(ClientKizReviewRequired);expect(db.kizReviewCase.upsert).not.toHaveBeenCalled();
});
it('retains competing FBO and FBS bindings',async()=>{
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');
 for(const kind of ['FBO','FBS']){const {db,units}=fixture(1);
  if(kind==='FBO')db.fboAssemblyUnit.findMany.mockImplementation(async({where}:any)=>where.requestId==='r'?units:where.requestId?.not?[{kiz:code(0),assembly:{request:{status:'IN_WORK'}}}]:[]);
  else db.fbsTsdAssembly.findMany.mockResolvedValue([{id:'another',requestId:'another',kiz:code(0)}]);
  await expect(assertClientRequestKizShipment(db,request,{id:'worker'})).rejects.toThrow('другой сборкой');
 }
});
it('retains a competing first-use claim',async()=>{
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');const {db}=fixture(1);db.kizReviewCase.findMany.mockResolvedValue([{id:'other',taskId:'GUARD:FBO:c:other',kizIdentity:code(0),status:'CLAIMED',requestId:'other',resolution:'FIRST_USE'}]);
 await expect(assertClientRequestKizShipment(db,request,{id:'worker'})).rejects.toThrow('другой сборкой');
});
it('fails closed when a bounded batch is saturated',async()=>{
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');const {db,marks}=fixture(1);db.productMark.findMany.mockResolvedValue(Array(10021).fill(marks[0]));
 await expect(assertClientRequestKizShipment(db,request,{id:'worker'})).rejects.toThrow('Слишком много');
});
it('rejects changed request ownership before cached reads',async()=>{
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');const {db}=fixture(1);db.clientRequest.findUnique.mockResolvedValue({...request,clientId:'other'});
 await expect(assertClientRequestKizShipment(db,request,{id:'worker'})).rejects.toThrow('клиент изменились');expect(db.productMark.findMany).not.toHaveBeenCalled();
});

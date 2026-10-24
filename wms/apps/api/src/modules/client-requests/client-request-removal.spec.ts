import {beforeEach,describe,it,expect,vi} from 'vitest';
import {ClientRequestRemovalService} from './client-request-removal.service';
import {ClientScopeService} from '../auth/client-scope.service';
import {assertOrdersNotRemoved,withoutRemovedOrders,assertRequestNotRemoved} from './request-removal-policy';

// TEST: guard and transaction tests use no production data or marketplace calls.
describe('administrative removal',()=>{
 let db:any,r:any,service:ClientRequestRemovalService;
 const user:any={id:'owner',roleCodes:['OWNER'],permissionCodes:['system:admin'],clientIds:[],writableClientIds:[]};
 beforeEach(()=>{
  vi.stubEnv('WMS_REQUEST_REMOVAL_ENABLED','true');
  r={id:'r',number:100,title:'FBO Ozon',type:'OUTBOUND',status:'SUBMITTED',clientId:'c',warehouseId:'w',updatedAt:new Date('2026-10-24'),managerComment:null,items:[{id:'i',quantity:3}],fbsOrderLinks:[],ozonShipment:{requestId:'r'},_count:{deliveryRequests:0}};
  db={clientRequest:{findUnique:vi.fn(async()=>r),update:vi.fn(async()=>r)},fbsTsdAssembly:{findMany:vi.fn(async()=>[]),updateMany:vi.fn(async()=>({count:0}))},fbsOrderRequestLink:{findMany:vi.fn(async()=>[]),updateMany:vi.fn(async()=>({count:0}))},auditLog:{findFirst:vi.fn(async()=>null),create:vi.fn(async()=>({id:'audit'}))},clientRequestEvent:{create:vi.fn(async()=>({}))},$queryRaw:vi.fn(async()=>[{locked:true}])};
  for(const name of ['fboAssemblyUnit','clientRequestPackage','stockMovement','tsdOperation','fbsPrintJob','pickWaveRequest'])db[name]={count:vi.fn(async()=>0)};
  db.$transaction=vi.fn(async(fn:any)=>fn(db));service=new ClientRequestRemovalService(db,new ClientScopeService());
 });
 async function input(){const p=await service.preview('r',user);return {number:100,reason:'Ошибочная сборка',confirmed:true,revision:p.revision};}
 // TEST: completed audited return must not be blocked by historical TSD scans.
 it.each(['returned','transferred','missing audit','incomplete','active unit','holding stock','new scan','legacy scan','wrong mark','wrong warehouse','wrong target','packing','printing','new pick after preview'])('checks audited disposition: %s',async scenario=>{
  db.tsdOperation.count.mockResolvedValue(1);
  db.tsdOperation.findMany=vi.fn(async()=>[{operationType:'assembly_stage',createdAt:new Date('2026-10-23')}]);
  db.fboAssemblyUnit.findMany=vi.fn(async()=>[{id:'u',state:'RETURNED',activeMarkId:null,markId:'m',skuId:'s',kiz:'k',sourceBoxId:'box',sourceBoxCode:'BOX'}]);
  db.fboAssembly={findUnique:vi.fn(async()=>({phase:'PICKING'}))};
  db.stockBalance={count:vi.fn(async()=>0)};
  db.productMark={findMany:vi.fn(async()=>[{id:'m',skuId:'s',clientId:'c',value:'k',status:'AVAILABLE',boxId:'box'}])};
  db.box={findUnique:vi.fn(async()=>({id:'box',clientId:'c',warehouseId:'w'}))};
  db.auditLog.findFirst.mockResolvedValue({createdAt:new Date('2026-10-24'),payload:{result:{mappings:[{oldUnitId:'u',newUnitId:null,markId:'m',destination:'BOX'}]},before:{requests:[{id:'r',fboAssembly:{units:[{id:'u',markId:'m',skuId:'s',kiz:'k'}]}}]}}});
  if(scenario==='missing audit')db.auditLog.findFirst.mockResolvedValue(null);
  if(scenario==='incomplete')db.fboAssemblyUnit.findMany.mockResolvedValue([]);
  if(scenario==='active unit')db.fboAssemblyUnit.count.mockResolvedValue(1);
  if(scenario==='holding stock')db.stockBalance.count.mockResolvedValue(1);
  if(scenario==='new scan')db.tsdOperation.findMany.mockResolvedValue([{operationType:'assembly_stage',createdAt:new Date('2026-10-25')}]);
  if(scenario==='legacy scan')db.tsdOperation.findMany.mockResolvedValue([{operationType:'move_scan',createdAt:new Date('2026-10-23')}]);
  if(scenario==='wrong mark')db.productMark.findMany.mockResolvedValue([]);
  if(scenario==='wrong warehouse')db.box.findUnique.mockResolvedValue({clientId:'c',warehouseId:'other'});
  if(scenario==='packing')db.clientRequestPackage.count.mockResolvedValue(1);
  if(scenario==='printing')db.fbsPrintJob.count.mockResolvedValue(1);
  if(scenario==='transferred'||scenario==='wrong target'){
   const audit=await db.auditLog.findFirst();audit.payload.result.mappings[0]={oldUnitId:'u',newUnitId:'new',markId:'m',destination:101};
   db.fboAssemblyUnit.findUnique=vi.fn(async()=>({requestId:'target',state:'PICKED',activeMarkId:'m',markId:'m',skuId:'s',kiz:'k',assembly:{request:{number:101,clientId:scenario==='wrong target'?'other':'c',warehouseId:'w',status:'IN_WORK'}}}));
   db.productMark.findMany.mockResolvedValue([{id:'m',skuId:'s',clientId:'c',value:'k',status:'PACKING',boxId:'box'}]);
  }
  if(scenario==='new pick after preview'){
   const data=await input();db.fboAssemblyUnit.count.mockResolvedValue(1);
   await expect(service.remove('r',data,user)).rejects.toThrow('фактический');expect(db.clientRequest.update).not.toHaveBeenCalled();return;
  }
  expect((await service.preview('r',user)).allowed).toBe(['returned','transferred'].includes(scenario));
  expect(db.tsdOperation.deleteMany).toBeUndefined();
 });
 it('preserves composition and history, cancels only WMS work',async()=>{
  const data=await input();expect(await service.remove('r',data,user)).toMatchObject({removed:true});
  expect(db.clientRequest.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'CANCELLED'})}));
  expect(db.auditLog.create).toHaveBeenCalledWith({data:expect.objectContaining({action:'CLIENT_REQUEST_ADMIN_REMOVED',payload:expect.objectContaining({externalCancellation:false})})});
  expect(r.items).toEqual([{id:'i',quantity:3}]);expect(db.clientRequestEvent.create).toHaveBeenCalledTimes(1);
 });
 it('blocks a pick that starts after preview',async()=>{const data=await input();db.fboAssemblyUnit.count.mockResolvedValue(1);await expect(service.remove('r',data,user)).rejects.toThrow('фактический');expect(db.clientRequest.update).not.toHaveBeenCalled();});
 it('blocks a changed request',async()=>{const data=await input();r.items[0].quantity=4;await expect(service.remove('r',data,user)).rejects.toThrow('изменилась');});
 it('blocks concurrent FBS ownership',async()=>{r.fbsOrderLinks=[{connectionId:'m',orderId:'o'}];const data=await input();db.$queryRaw.mockResolvedValue([{locked:false}]);await expect(service.remove('r',data,user)).rejects.toThrow('другой операцией');});
 it.each(['physical','wave','shipment','print'])('blocks %s work',async kind=>{if(kind==='physical')db.stockMovement.count.mockResolvedValue(1);if(kind==='wave')db.pickWaveRequest.count.mockResolvedValue(1);if(kind==='shipment')r._count.deliveryRequests=1;if(kind==='print')db.fbsPrintJob.count.mockResolvedValue(1);expect((await service.preview('r',user)).allowed).toBe(false);});
 it('blocks a task assigned to an employee before the first scan',async()=>{db.fbsTsdAssembly.findMany.mockResolvedValue([{status:'RESERVED',workerUserId:'worker'}]);expect((await service.preview('r',user)).allowed).toBe(false);});
 it('requires confirmation, reason and exact number',async()=>{const data=await input();for(const bad of [{...data,number:101},{...data,reason:' '},{...data,confirmed:false}])await expect(service.remove('r',bad,user)).rejects.toThrow();expect(db.clientRequest.update).not.toHaveBeenCalled();});
 it('denies client and demo sessions',async()=>{for(const u of [{...user,roleCodes:['CLIENT']},{...user,isDemo:true}])await expect(service.preview('r',u)).rejects.toThrow('администратору');});
 it('honours client and branch write scopes',async()=>{const u={...user,permissionCodes:[],clientScopeMode:'SELECTED',clientIds:['c'],writableClientIds:[],activeWarehouseId:'w',warehouseIds:['w'],writableWarehouseIds:['w']};await expect(service.preview('r',u)).rejects.toThrow();u.writableClientIds=['c'];r.warehouseId='other';await expect(service.preview('r',u)).rejects.toThrow();});
 it('is disabled outside the opted-in installation',async()=>{vi.stubEnv('WMS_REQUEST_REMOVAL_ENABLED','false');await expect(service.preview('r',user)).rejects.toThrow();expect(service.capability(user).enabled).toBe(false);});
 it('blocks recreation while leaving unrelated orders eligible',async()=>{db.fbsOrderRequestLink.findMany.mockResolvedValue([{connectionId:'m',orderId:'old'}]);const orders=[{connectionId:'m',id:'old'},{connectionId:'m',id:'new'}];await expect(assertOrdersNotRemoved(db,'c',orders)).rejects.toThrow('old');expect(await withoutRemovedOrders(db,'c',orders)).toEqual([orders[1]]);});
 it('prevents manual resurrection and tolerates a repeated removal',async()=>{const data=await input();db.auditLog.findFirst.mockResolvedValue({id:'a'});r.status='CANCELLED';await expect(assertRequestNotRemoved(db,'r')).rejects.toThrow('удалена');expect(await service.remove('r',data,user)).toMatchObject({alreadyRemoved:true});expect(db.clientRequest.update).not.toHaveBeenCalled();});
});

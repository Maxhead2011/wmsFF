import {afterEach,describe,it,expect,vi} from 'vitest';
import {reopenOzonBox} from '../src/modules/tsd/ozon-reopen-box';
// TEST: reopening changes only closure state, never units or stock.
describe('Ozon carton top-up',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 const box={id:'parcel',requestId:'r',direction:'Москва',closedAt:new Date(),wholeBox:false};
 const run=(parcel:any=box,shipment:any={integration:null},direction='Москва')=>{
  vi.stubEnv('WMS_OZON_REOPEN_BOX_ENABLED','true');
  const update=vi.fn();
  return {update,call:()=>reopenOzonBox({fboAssemblyBox:{update}} as any,shipment,'r',parcel,direction)};
 };
 it('reopens its closed carton without changing direction or quantities',async()=>{const t=run();await t.call();expect(t.update).toHaveBeenCalledWith({where:{id:'parcel'},data:{closedAt:null,confirmedAt:null,confirmedByUserId:null}});});
 it.each([null,{...box,requestId:'other'},{...box,direction:'Казань'},{...box,wholeBox:true},{...box,closedAt:null}])('rejects an invalid carton',async b=>{const t=run(b);await expect(t.call()).rejects.toThrow();expect(t.update).not.toHaveBeenCalled();});
 it('blocks frozen cargoes',async()=>{const t=run(box,{integration:{frozenHash:'hash'}});await expect(t.call()).rejects.toThrow('зафиксирован');expect(t.update).not.toHaveBeenCalled();});
 it('requires explicit feature and Ozon shipment',async()=>{const t=run();vi.stubEnv('WMS_OZON_REOPEN_BOX_ENABLED','false');await expect(t.call()).rejects.toThrow();const wb=run(box,null);await expect(wb.call()).rejects.toThrow();});
});
// TEST: real dispatcher uses durable replay, rather than reopening twice after a lost response.
import {FboTwoStageService} from '../src/modules/tsd/fbo-two-stage.service';
import {createHash} from 'node:crypto';
it('dispatches and audits REOPEN_BOX once across retries',async()=>{
 vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');vi.stubEnv('WMS_OZON_REOPEN_BOX_ENABLED','true');
 let receipt:any=null;
 const parcel={id:'b',requestId:'r',direction:'Москва',closedAt:new Date(),wholeBox:false};
 const update=vi.fn(async()=>{parcel.closedAt=null as any;});const audit=vi.fn();
 const tx:any={$queryRaw:vi.fn(async()=>[]),
  ozonFboShipment:{findUnique:async()=>({directions:[],integration:null})},
  fboAssemblyAction:{findUnique:async()=>receipt,create:async({data}:any)=>{receipt=data;}},
  fboAssembly:{findUnique:async()=>({phase:'PACKING',compositionHash:createHash('sha256').update('[]').digest('hex')})},
  fboAssemblyUnit:{findMany:async()=>[]},fboAssemblyBox:{findMany:async()=>[],findUnique:async()=>parcel,update},auditLog:{create:audit}};
 const svc:any=Object.create(FboTwoStageService.prototype);
 svc.prisma={$transaction:async(cb:any)=>cb(tx)};svc.lock={assertStockMovementsAllowed:async()=>{}};
 svc.load=async()=>({id:'r',status:'IN_WORK',items:[],client:{}});svc.requireFbo=()=>{};
 svc.box=async()=>({id:'box'});svc.requireIdleBox=async()=>{};svc.plan=async()=>({});
 const dto={action:'REOPEN_BOX',operationId:'operation-123',targetBoxCode:'BOX',direction:'Москва'};
 try{
  await svc.act('r',dto,{id:'u'});await svc.act('r',dto,{id:'u'});
  expect(update).toHaveBeenCalledTimes(1);expect(audit).toHaveBeenCalledTimes(1);
  expect(audit.mock.calls[0][0].data.action).toBe('FBO_REOPEN_BOX');
  await expect(svc.act('r',{...dto,direction:'Казань'},{id:'u'})).rejects.toThrow('другими данными');
 }finally{vi.unstubAllEnvs();}
});

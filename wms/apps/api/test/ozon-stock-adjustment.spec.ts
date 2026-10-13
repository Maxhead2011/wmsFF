import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {adjustmentHash,adjustmentRows,validateAdjustment} from '../src/modules/tsd/ozon-adjustment-policy';
import {assertSupplyMutable} from '../src/modules/client-requests/ozon-supply-policy';
import {OzonStockAdjustmentService} from '../src/modules/tsd/ozon-stock-adjustment.service';
vi.mock('../src/common/stock/wb-order-stock-lifecycle',()=>({wbReservationQuantities:vi.fn(async()=>new Map([['sku',2]]))}));
const rowsPlan=(picked=0,packed=0)=>({lines:[{skuId:'sku',needed:10,picked}],directions:[{name:'A',items:[{skuId:'sku',barcode:'123',quantity:6,packed}]},{name:'B',items:[{skuId:'sku',barcode:'123',quantity:4,packed:0}]}]});
// TEST: picked + unreserved stock, per-direction packing floors, and stable composition hashes.
describe('Ozon adjustment allocation',()=>{
 it('keeps all received units even when none has a route',()=>expect(adjustmentRows(rowsPlan(),{sku:10}).map(r=>r.after)).toEqual([6,4]));
 it('allocates scarce units proportionally without losing a unit',()=>expect(adjustmentRows(rowsPlan(),{sku:7}).map(r=>r.after)).toEqual([4,3]));
 it('does not reduce picked or packed units',()=>expect(adjustmentRows(rowsPlan(7,6),{sku:1}).map(r=>r.after)).toEqual([6,1]));
 it('permits redistribution while preserving each SKU total',()=>expect(validateAdjustment(adjustmentRows(rowsPlan(),{sku:7}),[3,4]).map(r=>r.after)).toEqual([3,4]));
 it.each([[2,4],[3.5,3.5],[-1,8],[7,0]])('rejects invalid quantities %j',(...q)=>expect(()=>validateAdjustment(adjustmentRows(rowsPlan(),{sku:7}),q)).toThrow());
 it('rejects silently cancelling an empty direction',()=>expect(()=>validateAdjustment(adjustmentRows(rowsPlan(),{sku:4}),[4,0])).toThrow('пустым'));
 it('matches the existing assembly composition hash',()=>{const a=[['i','s','123',4]];expect(adjustmentHash(a)).toBe(createHash('sha256').update(JSON.stringify(a)).digest('hex'));});
 it.each(['PICK','PACK','FINISH'])('blocks %s throughout uncertain adjustment',action=>expect(()=>assertSupplyMutable({adjustment:{state:'RUNNING'}},action)).toThrow('корректировка'));
 it('releases the guard after verified application',()=>expect(()=>assertSupplyMutable({adjustment:{state:'APPLIED'}},'PICK')).not.toThrow());
});
function setup(){
 vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');
 const link:any={connectionId:'c',orderId:'123',orderNumber:'123',state:'DATA_FILLING',mapping:{A:'42'},operations:{},supplies:[{id:'42',name:'A',items:[{sku:'99',barcode:'123',offerId:'a',quantity:10,quant:1}]}]};
 const s:any={requestId:'r',directions:[{name:'A',items:[{skuId:'sku',barcode:'123',quantity:10}]}],integration:link,request:{id:'r',clientId:'client',warehouseId:'w',status:'SUBMITTED',items:[{id:'i',skuId:'sku',barcode:'123',quantity:10}],fboAssembly:{phase:'PICKING',units:[{id:'u1',state:'PICKED',targetBoxId:null}],boxes:[]}}};
 const remote=structuredClone(link);
 const db:any={ozonFboShipment:{findUnique:vi.fn(async()=>structuredClone(s)),update:vi.fn(async({data}:any)=>Object.assign(s,structuredClone(data)))},clientMarketplaceConnection:{findFirst:vi.fn(async()=>({id:'c',sellerId:'seller',apiKey:'secret'}))},auditLog:{create:vi.fn()},stockBalance:{findMany:vi.fn(async()=>[{skuId:'sku',quantity:8}])},clientRequestItem:{update:vi.fn(async({data}:any)=>Object.assign(s.request.items[0],data)),delete:vi.fn()},fboAssembly:{update:vi.fn()},$queryRaw:vi.fn()};db.$transaction=async(fn:any)=>fn(db);
 const plan:any={needed:10,route:[],pendingLocations:[{skuId:'sku',boxCode:'BOX',quantity:8}],lines:[{skuId:'sku',needed:10,picked:1,remaining:9,pendingPlacementQuantity:8}],directions:[{name:'A',items:[{skuId:'sku',barcode:'123',quantity:10,packed:0}]}]};
 const fbo={adjustmentContext:vi.fn(async()=>({request:s.request,plan}))};
 const ozon:any={snapshot:vi.fn(async()=>structuredClone(remote)),call:vi.fn(async(_c:any,path:string,body:any,read:any)=>{
  if(path.endsWith('/supplies/get'))return {supplies_cargoes:[{supply_id:42,cargoes_without_transport_cargoes:[],transport_cargoes:[]}]};
  if(path.endsWith('/content/update')){expect(read).toBe(false);expect(s.integration.adjustment.operations[0].state).toBe('SENDING');expect(db.clientRequestItem.update).not.toHaveBeenCalled();remote.supplies[0].items[0].quantity=body.items[0].quantity;return {operation_id:'op'};}
  return {status:'SUCCESS'};
 })};
 const user:any={id:'u',activeWarehouseId:'w',permissionCodes:['system:admin']},scopes={requireClientAccess:vi.fn()},svc=new OzonStockAdjustmentService(db,scopes as any,fbo as any,ozon);
 const start=async()=>{const p=await svc.preview('r',user);return svc.start('r',{token:p.token,quantities:p.rows.map(r=>r.after),confirm:true},user);};
 return {svc,s,db,ozon,remote,plan,user,scopes,start};
}
// TEST: external writes are durable, exactly once per intent, and local changes wait for verified remote composition.
describe('Ozon adjustment lifecycle',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('previews picked + pending stock less other reserves without writes',async()=>{const x=setup(),p=await x.svc.preview('r',x.user);expect(p.after).toBe(7);expect(p.pendingLocations[0].boxCode).toBe('BOX');expect(x.db.ozonFboShipment.update).not.toHaveBeenCalled();expect(x.ozon.call.mock.calls.every((c:any)=>c[1].endsWith('/supplies/get'))).toBe(true);});
 it('applies only after successful status and refreshed quantities',async()=>{const x=setup();expect((await x.start()).operation?.state).toBe('APPLIED');expect(x.s.request.items[0].quantity).toBe(7);expect(x.s.directions[0].items[0].quantity).toBe(7);expect(x.db.fboAssembly.update).toHaveBeenCalled();await x.svc.resume('r',x.user);expect(x.ozon.call.mock.calls.filter((c:any)=>c[1].endsWith('/content/update'))).toHaveLength(1);});
 it('refuses a stale stock preview before any external write',async()=>{const x=setup(),p=await x.svc.preview('r',x.user);x.db.stockBalance.findMany.mockResolvedValue([{skuId:'sku',quantity:4}]);await expect(x.svc.start('r',{token:p.token,quantities:[7],confirm:true},x.user)).rejects.toThrow('изменились');expect(x.db.ozonFboShipment.update).not.toHaveBeenCalled();});
 it('does not retry a lost response or unlock an uncertain operation',async()=>{const x=setup(),original=x.ozon.call.getMockImplementation();x.ozon.call.mockImplementation(async(...a:any[])=>{if(a[1].endsWith('/content/update'))throw Error('timeout');return original(...a);});await x.start();await x.svc.resume('r',x.user);expect(x.s.integration.adjustment.operations[0].state).toBe('UNKNOWN');expect(x.db.clientRequestItem.update).not.toHaveBeenCalled();expect(x.ozon.call.mock.calls.filter((c:any)=>c[1].endsWith('/content/update'))).toHaveLength(1);await expect(x.svc.cancel('r',x.user)).rejects.toThrow('неподтверждённая');});
 it('does not apply a success status with stale remote contents',async()=>{const x=setup(),original=x.ozon.call.getMockImplementation();x.ozon.call.mockImplementation(async(...a:any[])=>a[1].endsWith('/content/update')?{operation_id:'op'}:original(...a));await x.start();expect(x.s.integration.adjustment.state).toBe('RUNNING');expect(x.db.clientRequestItem.update).not.toHaveBeenCalled();});
 it('can cancel a conclusively rejected unchanged request',async()=>{const x=setup(),original=x.ozon.call.getMockImplementation();x.ozon.call.mockImplementation(async(...a:any[])=>a[1].endsWith('/content/update')?{errors:['invalid']} :original(...a));await x.start();expect((await x.svc.cancel('r',x.user)).operation?.state).toBe('CANCELLED');expect(x.db.clientRequestItem.update).not.toHaveBeenCalled();});
 it('blocks existing cargoes before submitting',async()=>{const x=setup();x.ozon.call.mockResolvedValue({supplies_cargoes:[{supply_id:42,cargoes_without_transport_cargoes:[{cargo_id:1}]}]});await expect(x.start()).rejects.toThrow('грузоместа');expect(x.db.ozonFboShipment.update).not.toHaveBeenCalled();});
 it('rejects another branch and respects disabled installation flag',async()=>{const x=setup();await expect(x.svc.preview('r',{...x.user,activeWarehouseId:'other'})).rejects.toThrow('филиал');vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','false');await expect(x.svc.preview('r',x.user)).rejects.toThrow('выключено');});
 it('freezes partial success without changing WMS or resending either direction',async()=>{
  const x=setup();x.s.directions=[{name:'A',items:[{skuId:'sku',barcode:'123',quantity:6}]},{name:'B',items:[{skuId:'sku',barcode:'123',quantity:4}]}];x.plan.directions=rowsPlan(1).directions;
  x.remote.supplies[0].items[0].quantity=6;x.remote.supplies.push({id:'43',name:'B',items:[{sku:'99',barcode:'123',quantity:4,quant:1}]});x.s.integration=structuredClone(x.remote);x.s.integration.mapping={A:'42',B:'43'};
  x.ozon.call.mockImplementation(async(_c:any,path:string,body:any)=>{
   if(path.endsWith('/supplies/get'))return {supplies_cargoes:[{supply_id:body.supply_ids[0]}]};
   if(path.endsWith('/content/update')){if(body.supply_id===43)return {errors:['blocked']};x.remote.supplies[0].items[0].quantity=body.items[0].quantity;return {operation_id:'op'};}return {status:'SUCCESS'};
  });await x.start();await x.svc.resume('r',x.user);expect(x.s.integration.adjustment.operations.map((o:any)=>o.state)).toEqual(['SUCCESS','FAILED']);expect(x.db.clientRequestItem.update).not.toHaveBeenCalled();expect(x.ozon.call.mock.calls.filter((c:any)=>c[1].endsWith('/content/update'))).toHaveLength(2);await expect(x.svc.cancel('r',x.user)).rejects.toThrow();
 });
 it('does not overwrite an assembly closed by another operation during the Ozon request',async()=>{const x=setup(),original=x.ozon.call.getMockImplementation();x.ozon.call.mockImplementation(async(...a:any[])=>{const out=await original(...a);if(a[1].endsWith('/content/update/status'))x.s.request.status='DONE';return out;});await expect(x.start()).rejects.toThrow('Статус сборки изменился');expect(x.db.clientRequestItem.update).not.toHaveBeenCalled();});
 it('requires explicit confirmation',async()=>{const x=setup();await expect(x.svc.start('r',{token:'',quantities:[],confirm:false},x.user)).rejects.toThrow('Подтвердите');expect(x.ozon.call).not.toHaveBeenCalled();});
});

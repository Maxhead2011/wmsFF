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
 const s:any={requestId:'r',directions:[{name:'A',items:[{skuId:'sku',barcode:'123',quantity:10}]}],integration:link,request:{id:'r',clientId:'client',warehouseId:'w',status:'SUBMITTED',items:[{id:'i',skuId:'sku',barcode:'123',quantity:10}],fboAssembly:{phase:'PICKING',units:[{id:'u1',skuId:'sku',state:'PICKED',targetBoxId:null}],boxes:[]}}};
 const remote=structuredClone(link);
 const db:any={ozonFboShipment:{findUnique:vi.fn(async()=>structuredClone(s)),update:vi.fn(async({data}:any)=>Object.assign(s,structuredClone(data)))},clientMarketplaceConnection:{findFirst:vi.fn(async()=>({id:'c',sellerId:'seller',apiKey:'secret'}))},auditLog:{create:vi.fn()},stockBalance:{findMany:vi.fn(async()=>[{skuId:'sku',quantity:8}])},clientRequestItem:{update:vi.fn(async({data}:any)=>Object.assign(s.request.items[0],data)),delete:vi.fn()},fboAssembly:{update:vi.fn()},$queryRaw:vi.fn()};db.$transaction=async(fn:any)=>fn(db);
 db.sku={findMany:vi.fn(async()=>[{id:'sku',name:'Dress',barcodes:[{value:'123'}]}])};
 const plan:any={needed:10,route:[],pendingLocations:[{skuId:'sku',boxCode:'BOX',quantity:8}],lines:[{skuId:'sku',needed:10,picked:1,remaining:9,pendingPlacementQuantity:8}],directions:[{name:'A',items:[{skuId:'sku',barcode:'123',quantity:10,packed:0}]}]};
 const fbo={adjustmentContext:vi.fn(async()=>({request:s.request,plan}))};
 const ozon:any={snapshot:vi.fn(async()=>structuredClone(remote)),call:vi.fn(async(_c:any,path:string,body:any,read:any)=>{
  if(path.endsWith('/supplies/get'))return {supplies_cargoes:[{supply_id:42,cargoes_without_transport_cargoes:[],transport_cargoes:[]}]};
  if(path.endsWith('/content/update')){expect(read).toBe(false);expect(s.integration.adjustment.operations[0].state).toBe('SENDING');expect(db.clientRequestItem.update).not.toHaveBeenCalled();remote.supplies[0].items[0].quantity=body.items[0].quantity;return {operation_id:'op'};}
  return {status:'SUCCESS'};
 })};
 const user:any={id:'u',activeWarehouseId:'w',permissionCodes:['system:admin']},scopes={requireClientAccess:vi.fn()},svc=new OzonStockAdjustmentService(db,scopes as any,fbo as any,ozon);
 const start=async()=>{const p=await svc.preview('r',user);return svc.start('r',{token:p.token,quantities:p.rows.map(r=>r.after),confirm:true},user);};
 return {svc,s,db,ozon,remote,plan,user,scopes,start,fbo};
}
// TEST: permanent reconciliation preserves physical progress, including the CONTROL stage.
describe('Ozon physical reconciliation',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 function packed(){const x=setup();x.s.request.status='IN_WORK';x.s.request.fboAssembly.phase='CONTROL';x.s.request.fboAssembly.boxes=[{id:'box',boxId:'b',direction:'A',closedAt:'2026-11-07',confirmedAt:null}];x.s.request.fboAssembly.units=Array.from({length:7},(_,i)=>({id:'u'+i,skuId:'sku',state:'PACKED',targetBoxId:'b'}));return x;}
 const preview=(x:any,mode='AVAILABLE')=>(x.svc.preview as any)('r',x.user,{mode});
 const apply=(x:any,p:any,mode='AVAILABLE')=>x.svc.start('r',{token:p.token,quantities:p.rows.map((r:any)=>r.after),confirm:true,mode} as any,x.user);
 // TEST: real Ozon ERROR is terminal; resuming must never submit it twice or alter boxes.
 it.each(['ERROR','FAILED'])('reports %s capacity rejection with direction and preserves packed boxes',async status=>{
  const x=packed(),before=structuredClone(x.s.request.fboAssembly),original=x.ozon.call.getMockImplementation();
  x.ozon.call.mockImplementation(async(...args:any[])=>args[1].endsWith('/content/update/status')?{status,errors:['INBOUND_NO_CAPACITY'],error_details:{items_quantity_limit:0}}:original(...args));
  const result=await apply(x,await preview(x));
  expect(result.operation.state).toBe('NEEDS_ATTENTION');
  expect(result.operation.operations[0]).toMatchObject({state:'FAILED',direction:'A',error:expect.stringContaining('недостаточно места')});
  expect(x.s.integration.adjustment.operations[0]).toMatchObject({remoteStatus:status,errorDetails:{items_quantity_limit:0}});
  await x.svc.resume('r',x.user);
  expect(x.ozon.call.mock.calls.filter((c:any)=>c[1].endsWith('/content/update'))).toHaveLength(1);
  expect(x.db.clientRequestItem.update).not.toHaveBeenCalled();expect(x.db.fboAssembly.update).not.toHaveBeenCalled();
  expect(x.s.request.fboAssembly).toEqual(before);
 });
 it('reconciles CONTROL from packed units and preserves every box and unit',async()=>{const x=packed(),before=structuredClone(x.s.request.fboAssembly),p=await preview(x);expect(p.after).toBe(7);expect(p.physicalBasis).toBe('PACKED');expect((await apply(x,p)).operation.state).toBe('APPLIED');expect(x.s.request.fboAssembly).toEqual(before);expect(x.fbo.adjustmentContext).not.toHaveBeenCalled();expect(x.db.stockBalance.findMany).not.toHaveBeenCalled();});
 // TEST: existing partial operations are repaired by polling only, without unlocking or discarding boxes.
 it('refreshes an existing accepted ERROR beside a success without resending or allowing cancel',async()=>{
  const x=packed(),before=structuredClone(x.s.request.fboAssembly),original=x.ozon.call.getMockImplementation();
  x.ozon.call.mockImplementation(async(...args:any[])=>args[1].endsWith('/content/update/status')?{status:'ERROR',errors:['INBOUND_NO_CAPACITY']}:original(...args));
  await apply(x,await preview(x));x.s.integration.adjustment.operations[0].state='ACCEPTED';
  x.s.integration.adjustment.operations.push({supplyId:'43',state:'SUCCESS',operationId:'already-done'});x.ozon.call.mockClear();
  const result=await x.svc.resume('r',x.user);expect(result.operation?.state).toBe('NEEDS_ATTENTION');
  expect(result.operation?.operations.map((o:any)=>o.state)).toEqual(['FAILED','SUCCESS']);
  expect(x.ozon.call.mock.calls.filter((c:any)=>c[1].endsWith('/content/update'))).toHaveLength(0);
  await expect(x.svc.cancel('r',x.user)).rejects.toThrow('успешная операция');
  expect(x.db.clientRequestItem.update).not.toHaveBeenCalled();expect(x.s.request.fboAssembly).toEqual(before);
 });
 it('allows remote-only drift when local quantity already equals packed',async()=>{const x=packed();x.s.request.items[0].quantity=7;x.s.directions[0].items[0].quantity=7;const p=await preview(x);expect(p.after).toBe(p.needed);expect(p.comparison[0]).toMatchObject({remote:10,after:7});expect((await apply(x,p)).operation.state).toBe('APPLIED');});
 it('uses picked-only basis without reading warehouse stock',async()=>{const x=setup(),p=await preview(x,'PICKED');expect(p.after).toBe(1);expect((await apply(x,p,'PICKED')).operation.state).toBe('APPLIED');expect(x.db.stockBalance.findMany).not.toHaveBeenCalled();});
 it('rejects remote changes since preview before any write',async()=>{const x=packed(),p=await preview(x);x.remote.supplies[0].items[0].quantity=9;await expect(apply(x,p)).rejects.toThrow('предпросмотр');expect(x.db.ozonFboShipment.update).not.toHaveBeenCalled();});
 it('pins box confirmation in the preview',async()=>{const x=packed(),p=await preview(x);x.s.request.fboAssembly.boxes[0].confirmedAt='now';await expect(apply(x,p)).rejects.toThrow();expect(x.db.ozonFboShipment.update).not.toHaveBeenCalled();});
 it.each(['frozen','cargo','unpacked','empty'])('rejects unsafe %s',async kind=>{const x=packed();if(kind==='frozen')x.s.integration.frozenHash='locked';if(kind==='cargo')x.ozon.call.mockResolvedValue({supplies_cargoes:[{supply_id:42,transport_cargoes:[{}]}]});if(kind==='unpacked')x.s.request.fboAssembly.units[0].state='PICKED';if(kind==='empty')x.s.request.fboAssembly.units=[];await expect(preview(x)).rejects.toThrow();expect(x.db.ozonFboShipment.update).not.toHaveBeenCalled();});
 it('requires catalog verification for a product absent from Ozon',async()=>{const x=packed();x.remote.supplies[0].items=[];await expect(preview(x)).rejects.toThrow('сопостав');expect(x.db.ozonFboShipment.update).not.toHaveBeenCalled();});
 it('preserves the legacy endpoint control restriction',async()=>{const x=packed();await expect(x.svc.preview('r',x.user)).rejects.toThrow();});
 it('adds an absent product only after matching its barcode, SKU and offer in this cabinet',async()=>{const x=packed();x.remote.supplies[0].items=[];const original=x.ozon.call.getMockImplementation();x.ozon.call.mockImplementation(async(...a:any[])=>{if(a[1].endsWith('/product/info/list'))return {items:[{sku:99,offer_id:'a',barcodes:['123']}]};if(a[1].endsWith('/content/update')){x.remote.supplies[0].items=[{sku:'99',offerId:'a',barcode:'123',quantity:a[2].items[0].quantity,quant:1}];return {operation_id:'op'};}return original(...a);});const p=await preview(x);expect(p.comparison[0]).toMatchObject({remote:0,after:7});expect((await apply(x,p)).operation.state).toBe('APPLIED');});
 it('cancels a rejected update against its remote snapshot, not the divergent WMS plan',async()=>{const x=packed();x.remote.supplies[0].items[0].quantity=12;const original=x.ozon.call.getMockImplementation();x.ozon.call.mockImplementation(async(...a:any[])=>a[1].endsWith('/content/update')?{errors:['rejected']}:original(...a));await apply(x,await preview(x));expect((await x.svc.cancel('r',x.user)).operation?.state).toBe('CANCELLED');expect(x.db.clientRequestItem.update).not.toHaveBeenCalled();});
 it('does not resend modern reconciliation after a lost response',async()=>{const x=packed(),original=x.ozon.call.getMockImplementation();x.ozon.call.mockImplementation(async(...a:any[])=>{if(a[1].endsWith('/content/update'))throw Error('lost');return original(...a);});await apply(x,await preview(x));await x.svc.resume('r',x.user);expect(x.s.integration.adjustment.operations[0].state).toBe('UNKNOWN');expect(x.ozon.call.mock.calls.filter((c:any)=>c[1].endsWith('/content/update'))).toHaveLength(1);expect(x.db.clientRequestItem.update).not.toHaveBeenCalled();});
 it('does not finish if a box changes while Ozon processes the operation',async()=>{const x=packed(),p=await preview(x),original=x.ozon.call.getMockImplementation();x.ozon.call.mockImplementation(async(...a:any[])=>{const result=await original(...a);if(a[1].endsWith('/content/update/status'))x.s.request.fboAssembly.boxes[0].confirmedAt='now';return result;});await expect(apply(x,p)).rejects.toThrow('Короба изменились');expect(x.db.clientRequestItem.update).not.toHaveBeenCalled();});
 it('still excludes other reservations in the availability mode',async()=>{const x=setup(),p=await preview(x);expect(p.physicalBasis).toBe('AVAILABLE');expect(p.after).toBe(7);expect(x.fbo.adjustmentContext).toHaveBeenCalledTimes(1);});
});
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
// TEST: inbound sync never writes Ozon or stock and refuses stale physical progress.
describe('Ozon inbound synchronization lifecycle',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('updates the current request, preserves units and reopens picking',async()=>{const x=setup();x.s.request.fboAssembly.phase='PACKING';x.remote.supplies[0].items[0].quantity=12;const units=structuredClone(x.s.request.fboAssembly.units);const p=await x.svc.syncPreview('r',x.user);expect(p.after).toBe(12);expect(x.db.clientRequestItem.update).not.toHaveBeenCalled();await x.svc.syncApply('r',{token:p.token,confirm:true},x.user);expect(x.s.request.items[0]).toMatchObject({id:'i',quantity:12});expect(x.s.request.fboAssembly.units).toEqual(units);expect(x.db.fboAssembly.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({phase:'PICKING'})}));expect(x.ozon.call.mock.calls.every((c:any)=>c[1].endsWith('/supplies/get'))).toBe(true);expect(x.db.auditLog.create).toHaveBeenCalled();});
 it.each(['remote','units','status'])('refuses a changed %s since preview',async kind=>{const x=setup(),p=await x.svc.syncPreview('r',x.user);if(kind==='remote')x.remote.supplies[0].items[0].quantity++;if(kind==='units')x.s.request.fboAssembly.units.push({id:'u2',state:'PICKED',skuId:'sku'});if(kind==='status')x.s.request.status='DONE';await expect(x.svc.syncApply('r',{token:p.token,confirm:true},x.user)).rejects.toThrow();expect(x.db.clientRequestItem.update).not.toHaveBeenCalled();});
 it('requires confirmation and preserves warehouse scope',async()=>{const x=setup();await expect(x.svc.syncApply('r',{token:'x',confirm:false},x.user)).rejects.toThrow();await expect(x.svc.syncPreview('r',{...x.user,activeWarehouseId:'other'})).rejects.toThrow();});
 it('creates newly added Ozon positions without recreating existing lines',async()=>{const x=setup();x.remote.supplies[0].items.push({barcode:'456',quantity:3,sku:'100',quant:1});x.db.sku.findMany.mockResolvedValue([{id:'sku',name:'Dress',barcodes:[{value:'123'}]},{id:'new',name:'New dress',barcodes:[{value:'456'}]}]);x.db.clientRequestItem.create=vi.fn(async({data}:any)=>({id:'new-item',...data}));const p=await x.svc.syncPreview('r',x.user);expect(p.after).toBe(13);await x.svc.syncApply('r',{token:p.token,confirm:true},x.user);expect(x.db.clientRequestItem.create).toHaveBeenCalledWith({data:{requestId:'r',skuId:'new',name:'New dress',barcode:'456',quantity:3}});expect(x.db.clientRequestItem.delete).not.toHaveBeenCalled();expect(x.db.sku.findMany.mock.calls[0][0].where.clientId).toBe('client');});
 it('blocks cargoes and concurrent outbound adjustment',async()=>{const x=setup();x.ozon.call.mockResolvedValue({supplies_cargoes:[{supply_id:42,transport_cargoes:[{}]}]});await expect(x.svc.syncPreview('r',x.user)).rejects.toThrow('грузоместа');x.ozon.call.mockResolvedValue({supplies_cargoes:[{supply_id:42}]});x.s.integration.adjustment={state:'RUNNING'};await expect(x.svc.syncPreview('r',x.user)).rejects.toThrow('корректировка');});
});

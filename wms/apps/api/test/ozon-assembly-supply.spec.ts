import {afterEach,describe,it,expect,vi} from 'vitest';
import {OzonAssemblySupplyService} from '../src/modules/client-requests/ozon-assembly-supply.service';
// TEST: persistence precedes external writes, retries cannot duplicate cargoes.
function setup(){
 vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');
 const link:any={connectionId:'c',orderId:'123',orderNumber:'123',place:'Москва',date:'',state:'DATA_FILLING',checkedAt:'',mapping:{Москва:'42'},operations:{},supplies:[{id:'42',name:'Москва',items:[{barcode:'123',offerId:'a',quantity:1,quant:1}]}]};
 const shipment:any={requestId:'r',directions:[{name:'Москва',items:[{skuId:'sku',barcode:'123',quantity:1}]}],integration:link,request:{clientId:'client',warehouseId:'w',fboAssembly:{phase:'CONTROL',boxes:[{id:'b',boxId:'box',direction:'Москва',closedAt:'now',confirmedAt:'now'}],units:[{skuId:'sku',state:'PACKED',targetBoxId:'box'}]}}};
 const db:any={ozonFboShipment:{findUnique:vi.fn(async()=>shipment),update:vi.fn(async({data}:any)=>Object.assign(shipment,structuredClone(data)))},clientMarketplaceConnection:{findFirst:vi.fn(async()=>({id:'c',sellerId:'seller',apiKey:'secret'})),findMany:vi.fn(async()=>[])},auditLog:{create:vi.fn()},$queryRaw:vi.fn()};db.$transaction=async(fn:any)=>fn(db);
 const user:any={id:'u',activeWarehouseId:'w',permissionCodes:['system:admin']},scopes={requireClientAccess:vi.fn()},svc=new OzonAssemblySupplyService(db,scopes as any);
 vi.spyOn(svc,'refresh').mockImplementation(async()=>svc.view('r',user));
 const call=vi.spyOn(svc,'call').mockImplementation(async(_c,path)=>{if(path.endsWith('/supplies/get'))return {supplies_cargoes:[{supply_id:42,transport_cargoes:[],cargoes_without_transport_cargoes:[]}]};if(path==='/v1/cargoes/create'){expect(shipment.integration.operations['42'].state).toBe('SENDING');return {operation_id:'op'};}return {status:'SUCCESS',result:{cargoes:[{key:'b',value:{cargo_id:999}}]}};});
 return {svc,shipment,db,user,call};
}
describe('Ozon assembly delivery',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 // TEST: quantity correction must block cargo writes even before their claim transaction.
 it('blocks all Ozon mutation entry points during quantity adjustment',async()=>{const x=setup();x.shipment.integration.adjustment={state:'RUNNING'};await expect(x.svc.upload('r',true,x.user)).rejects.toThrow('корректировка');await expect(x.svc.labels('r','42',x.user)).rejects.toThrow('корректировка');await expect(x.svc.bind('r',{connectionId:'c',orderId:'9'},x.user)).rejects.toThrow('корректировка');expect(x.call).not.toHaveBeenCalled();});
 it('writes a durable claim before sending and never resends on retry',async()=>{const s=setup();await s.svc.upload('r',true,s.user);await s.svc.upload('r',true,s.user);expect(s.call.mock.calls.filter(c=>c[1]==='/v1/cargoes/create')).toHaveLength(1);expect(s.shipment.integration.operations['42'].state).toBe('SUCCESS');});
 it('blocks an ambiguous timeout and never retries that direction',async()=>{const s=setup();s.call.mockImplementation(async(_c,path)=>{if(path.endsWith('/supplies/get'))return {supplies_cargoes:[{supply_id:42}]};throw Error('timeout');});await expect(s.svc.upload('r',true,s.user)).rejects.toThrow('не подтверждён');expect(s.shipment.integration.operations['42'].state).toBe('UNKNOWN');await s.svc.upload('r',true,s.user);expect(s.call.mock.calls.filter(c=>c[1]==='/v1/cargoes/create')).toHaveLength(1);});
 it('never overwrites foreign cargoes',async()=>{const s=setup();s.call.mockResolvedValue({supplies_cargoes:[{supply_id:42,cargoes_without_transport_cargoes:[{cargo_id:1}]}]});await expect(s.svc.upload('r',true,s.user)).rejects.toThrow('замена запрещена');expect(s.call.mock.calls.some(c=>c[1]==='/v1/cargoes/create')).toBe(false);});
 it('requires confirmation and scoped branch',async()=>{const s=setup();await expect(s.svc.upload('r',false,s.user)).rejects.toThrow('Подтвердите');await expect(s.svc.view('r',{...s.user,activeWarehouseId:'other'})).rejects.toThrow('филиал');});
 it('blocks rebind and mapping after a delivery claim',async()=>{const s=setup();s.shipment.integration.frozenHash='hash';await expect(s.svc.bind('r',{connectionId:'c',orderId:'99'},s.user)).rejects.toThrow('заблокирована');await expect(s.svc.map('r',{},s.user)).rejects.toThrow('началась');});
 it('does not label unconfirmed cargoes',async()=>{const s=setup();await expect(s.svc.labels('r','42',s.user)).rejects.toThrow('подтверждения');expect(s.call).not.toHaveBeenCalled();});
 // TEST: a completed remote order must not block another unsent order of the shared assembly.
 it('continues remaining orders while preserving completed receipts',async()=>{
  const s=setup(),l=s.shipment.integration;l.orders=[{orderId:'old',state:'COMPLETED',supplies:[{id:'old'}]},{orderId:'123',state:'DATA_FILLING',supplies:l.supplies}];l.operations.old={state:'SUCCESS'};
  await s.svc.upload('r',true,s.user);expect(l.operations.old).toEqual({state:'SUCCESS'});expect(s.call.mock.calls.filter(c=>c[1]==='/v1/cargoes/create')).toHaveLength(1);
 });
 it('blocks unsent orders in an invalid remote state',async()=>{
  const s=setup();s.shipment.integration.orders=[{orderId:'123',state:'CANCELLED',supplies:s.shipment.integration.supplies}];
  await expect(s.svc.upload('r',true,s.user)).rejects.toThrow('заполнения');expect(s.call).not.toHaveBeenCalled();
 });
});

// TEST: explicit throttling is recoverable; ambiguous writes are not.
describe('Ozon cargo throttling',()=>{
 afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
 it('retries an explicitly rejected cargo creation after a delay',async()=>{
  vi.useFakeTimers();const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({message:'limit'}),{status:429})).mockResolvedValueOnce(new Response(JSON.stringify({operation_id:'op'})));
  vi.stubGlobal('fetch',fetcher);const svc=new OzonAssemblySupplyService({} as any,{} as any);
  const result=svc.call({sellerId:'s',apiKey:'k'},'/v1/cargoes/create',{},false);
  const check=expect(result).resolves.toEqual({operation_id:'op'});await vi.runAllTimersAsync();await check;expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('does not retry cargo network failures',async()=>{
  const fetcher=vi.fn().mockRejectedValue(Error('timeout'));vi.stubGlobal('fetch',fetcher);
  await expect(new OzonAssemblySupplyService({} as any,{} as any).call({},'/v1/cargoes/create',{},false)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('unblocks legacy 429 only after confirmed empty remote cargoes',async()=>{
  const x=setup();x.shipment.integration.operations['42']={state:'UNKNOWN',error:'Ozon: HTTP 429. limit'};
  await x.svc.status('r',x.user);expect(x.shipment.integration.operations['42']).toBeUndefined();expect(x.db.auditLog.create).toHaveBeenCalled();
 });
 it.each(['timeout','Ozon: HTTP 500. failure'])('preserves ambiguous rejection %s',async(error)=>{
  const x=setup();x.shipment.integration.operations['42']={state:'UNKNOWN',error};await x.svc.status('r',x.user);expect(x.shipment.integration.operations['42'].state).toBe('UNKNOWN');expect(x.call).not.toHaveBeenCalled();
 });
 it('does not unblock 429 when remote cargoes exist',async()=>{
  const x=setup();x.shipment.integration.operations['42']={state:'UNKNOWN',error:'Ozon: HTTP 429. limit'};x.call.mockResolvedValue({supplies_cargoes:[{supply_id:42,cargoes_without_transport_cargoes:[{cargo_id:1}]}]});await x.svc.status('r',x.user);expect(x.shipment.integration.operations['42'].state).toBe('UNKNOWN');
 });
});

// TEST: adjacent int64 cargo IDs must stay distinct in both HTTP directions.
describe('Ozon cargo int64 identity',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it('retains exact remote IDs and serializes numeric label IDs without Number conversion',async()=>{
  const ids=['1000000000064215122','1000000000064215123','1000000000064215124'];
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{"cargoes":['+ids.map(id=>'{"cargo_id":'+id+'}').join(',')+']}')).mockResolvedValueOnce(new Response('{}'));
  vi.stubGlobal('fetch',fetcher);
  const svc=new OzonAssemblySupplyService({} as any,{} as any);
  const result=await svc.call({},'/v2/cargoes/create/info',{});
  expect(result.cargoes.map((x:any)=>x.cargo_id)).toEqual(ids);
  await svc.call({},'/v1/cargoes-label/create',{cargoes:result.cargoes},false);
  expect(fetcher.mock.calls[1][1].body).toBe('{"cargoes":['+ids.map(id=>'{"cargo_id":'+id+'}').join(',')+']}');
 });
 it('passes stored cargo IDs to label creation as exact strings',async()=>{
  const x=setup();x.shipment.integration.operations['42']={state:'SUCCESS',cargoes:[{key:'b',cargoId:'1000000000064215122'}]};
  x.call.mockResolvedValueOnce({operation_id:'label-op'}).mockResolvedValueOnce({result:{file_url:'https://example.com/labels.pdf'}});
  await x.svc.labels('r','42',x.user);
  expect(x.call.mock.calls[0][2].cargoes[0].cargo_id).toBe('1000000000064215122');
  expect(x.shipment.integration.operations['42'].labelUrl).toBe('https://example.com/labels.pdf');
 });
});

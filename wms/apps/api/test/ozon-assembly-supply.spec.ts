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
 it('writes a durable claim before sending and never resends on retry',async()=>{const s=setup();await s.svc.upload('r',true,s.user);await s.svc.upload('r',true,s.user);expect(s.call.mock.calls.filter(c=>c[1]==='/v1/cargoes/create')).toHaveLength(1);expect(s.shipment.integration.operations['42'].state).toBe('SUCCESS');});
 it('blocks an ambiguous timeout and never retries that direction',async()=>{const s=setup();s.call.mockImplementation(async(_c,path)=>{if(path.endsWith('/supplies/get'))return {supplies_cargoes:[{supply_id:42}]};throw Error('timeout');});await expect(s.svc.upload('r',true,s.user)).rejects.toThrow('не подтверждён');expect(s.shipment.integration.operations['42'].state).toBe('UNKNOWN');await s.svc.upload('r',true,s.user);expect(s.call.mock.calls.filter(c=>c[1]==='/v1/cargoes/create')).toHaveLength(1);});
 it('never overwrites foreign cargoes',async()=>{const s=setup();s.call.mockResolvedValue({supplies_cargoes:[{supply_id:42,cargoes_without_transport_cargoes:[{cargo_id:1}]}]});await expect(s.svc.upload('r',true,s.user)).rejects.toThrow('замена запрещена');expect(s.call.mock.calls.some(c=>c[1]==='/v1/cargoes/create')).toBe(false);});
 it('requires confirmation and scoped branch',async()=>{const s=setup();await expect(s.svc.upload('r',false,s.user)).rejects.toThrow('Подтвердите');await expect(s.svc.view('r',{...s.user,activeWarehouseId:'other'})).rejects.toThrow('филиал');});
 it('blocks rebind and mapping after a delivery claim',async()=>{const s=setup();s.shipment.integration.frozenHash='hash';await expect(s.svc.bind('r',{connectionId:'c',orderId:'99'},s.user)).rejects.toThrow('заблокирована');await expect(s.svc.map('r',{},s.user)).rejects.toThrow('началась');});
 it('does not label unconfirmed cargoes',async()=>{const s=setup();await expect(s.svc.labels('r','42',s.user)).rejects.toThrow('подтверждения');expect(s.call).not.toHaveBeenCalled();});
});

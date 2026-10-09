import {afterEach,describe,it,expect,vi} from 'vitest';
import {OzonAssemblySupplyService} from '../src/modules/client-requests/ozon-assembly-supply.service';
import {mergeSupplyOrders,supplyOrders,supplyDifferences} from '../src/modules/client-requests/ozon-supply-policy';
// TEST: a second Ozon order must augment the same warehouse assembly, never replace it.
function setup(){
 vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');
 const order=(id:string)=>({connectionId:'c',orderId:id,orderNumber:id,place:'hub',date:'date',state:'DATA_FILLING',checkedAt:'',supplies:[{id:'s'+id,name:'d'+id,items:[{barcode:id,offerId:id,quantity:1,quant:1}]}],mapping:{},operations:{}});
 const shipment:any={requestId:'r',integration:order('1'),externalOrderKey:'seller:1',directions:['1','2'].map(id=>({name:'d'+id,items:[{skuId:id,barcode:id,quantity:1}]})),request:{clientId:'client',warehouseId:'w',fboAssembly:null}};
 shipment.integration.mapping={d1:'s1'};
 const owners=new Map<string,any>([['seller:1',{requestId:'r'}]]);
 const db:any={ozonFboShipment:{findUnique:vi.fn(async({where}:any)=>where.requestId?shipment:where.externalOrderKey===shipment.externalOrderKey?shipment:null),update:vi.fn(async({data}:any)=>Object.assign(shipment,structuredClone(data)))},ozonFboOrderBinding:{findUnique:vi.fn(async({where}:any)=>owners.get(where.externalOrderKey)),create:vi.fn(async({data}:any)=>owners.set(data.externalOrderKey,data))},ozonFboPlan:{findFirst:vi.fn(async()=>null)},clientMarketplaceConnection:{findFirst:vi.fn(async()=>({id:'c',sellerId:'seller',apiKey:'secret'})),findMany:vi.fn(async()=>[])},auditLog:{create:vi.fn()},$queryRaw:vi.fn()};db.$transaction=async(fn:any)=>fn(db);
 const svc=new OzonAssemblySupplyService(db,{requireClientAccess(){}} as any),user:any={id:'u',activeWarehouseId:'w',permissionCodes:['system:admin']};
 const snapshot=vi.spyOn(svc as any,'snapshot').mockImplementation(async(_c:any,id:any)=>order(id));
 return {svc,user,shipment,owners,db,snapshot,order};
}
describe('multiple Ozon orders',()=>{
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
 it('adds another order and preserves original demand, mapping and uniqueness',async()=>{
  const s=setup(),before=JSON.stringify(s.shipment.directions);
  await s.svc.bind('r',{connectionId:'c',orderId:'https://seller.ozon.ru/app/supply/orders/2?tab=items'},s.user);
  expect(supplyOrders(s.shipment.integration).map(o=>o.orderId)).toEqual(['1','2']);
  expect(s.shipment.integration.mapping).toEqual({d1:'s1',d2:'s2'});
  expect(supplyDifferences(s.shipment.directions,s.shipment.integration)).toEqual([]);
  expect(JSON.stringify(s.shipment.directions)).toBe(before);
  expect(s.owners.get('seller:2').requestId).toBe('r');
  await s.svc.bind('r',{connectionId:'c',orderId:'2'},s.user);
  expect(supplyOrders(s.shipment.integration)).toHaveLength(2);
 });
 it('rejects an additional order already owned by another assembly',async()=>{
  const s=setup();s.owners.set('seller:2',{requestId:'other'});
  await expect(s.svc.bind('r',{connectionId:'c',orderId:'2'},s.user)).rejects.toThrow('другой сборке');
  expect(supplyOrders(s.shipment.integration)).toHaveLength(1);
 });
 it('refreshes all orders without losing receipts or mapping',async()=>{
  const s=setup();s.shipment.integration=mergeSupplyOrders(s.shipment.integration,[s.order('1'),s.order('2')]);
  s.shipment.integration.operations={s1:{state:'SUCCESS',operationId:'op'}};s.shipment.integration.frozenHash='hash';
  await s.svc.refresh('r',s.user);
  expect(s.snapshot.mock.calls.map(c=>c[1])).toEqual(['1','2']);
  expect(s.shipment.integration).toMatchObject({mapping:{d1:'s1'},frozenHash:'hash',operations:{s1:{operationId:'op'}}});
 });
 it('rejects duplicate supply ownership even with different orders',()=>{
  const s=setup();expect(()=>mergeSupplyOrders(s.order('1'),[s.order('1'),{...s.order('1'),orderId:'2'}])).toThrow('Повтор');
 });
 it('blocks frozen additions and rejects a changed order set during refresh',async()=>{
  const s=setup();s.shipment.integration.frozenHash='hash';
  await expect(s.svc.bind('r',{connectionId:'c',orderId:'2'},s.user)).rejects.toThrow('заблокирована');
  delete s.shipment.integration.frozenHash;
  s.snapshot.mockImplementation(async()=>{s.shipment.integration=mergeSupplyOrders(s.order('1'),[s.order('1'),s.order('2')]);return s.order('1');});
  await expect(s.svc.refresh('r',s.user)).rejects.toThrow('изменилась');
 });
});

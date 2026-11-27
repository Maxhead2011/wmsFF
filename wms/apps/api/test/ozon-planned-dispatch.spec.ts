import {describe,it,expect,vi} from 'vitest';
import {OzonAssemblySupplyService} from '../src/modules/client-requests/ozon-assembly-supply.service';
function fixture(){
 const boxes=['a','b'].map((id,index)=>({key:id,boxCode:'FFL_'+id,supplyId:id,direction:id,items:[{skuId:id,barcode:id,quantity:1,zone:'SORT'}]}));
 const supplies=boxes.map(b=>({id:b.supplyId,name:b.direction,items:[{barcode:b.key,offerId:b.key,quantity:1,placementZone:'SORT',quant:1}]}));
 const link:any={connectionId:'c',orderId:'1',orderNumber:'1',state:'READY_TO_SUPPLY',supplies,mapping:{a:'a',b:'b'},operations:{a:{state:'QUEUED'},b:{state:'QUEUED'}},frozenHash:'fixed',packingPlan:{version:1,state:'SENDING',boxes,dispatch:{a:{cargoes:[],emptyCargoIds:[],replaceEmpty:false},b:{cargoes:[],emptyCargoIds:[],replaceEmpty:false}}}};
 const current:any={integration:link,request:{clientId:'c'},directions:boxes.map(b=>({name:b.direction,items:b.items}))};
 const service:any=new OzonAssemblySupplyService({} as any,{} as any);
 service.load=vi.fn(async()=>structuredClone(current));service.connection=vi.fn(async()=>({}));
 service.locked=vi.fn(async(_id:any,_user:any,fn:any)=>fn(current,{}));service.save=vi.fn(async()=>{});
 service.snapshot=vi.fn(async()=>structuredClone(link));
 service.call=vi.fn(async(_c:any,path:string,body:any)=>{
  if(path==='/v1/cargoes/supplies/get')return {supplies_cargoes:[{supply_id:body.supply_ids[0],transport_cargoes:[],cargoes_without_transport_cargoes:[]}]};
  if(path==='/v1/cargoes/create')return {operation_id:'op'};
  throw new Error('Unexpected '+path);
 });
 // Numeric supply IDs match the marketplace contract.
 for(let i=0;i<2;i++){const old=i?'b':'a',id=String(i+1);link.supplies[i].id=id;link.mapping[old]=id;link.packingPlan.boxes[i].supplyId=id;link.operations[id]=link.operations[old];delete link.operations[old];link.packingPlan.dispatch[id]=link.packingPlan.dispatch[old];delete link.packingPlan.dispatch[old];}
 return {service,current,link};
}
// TEST: these exercise the real dispatcher with external I/O replaced, including concurrent claims.
describe('planned cargo dispatch',()=>{
 it('claims one direction and keeps the next queued until confirmation',async()=>{
  const {service,link}=fixture();await service.dispatchPlanned('r',{});
  expect(link.operations['1']).toEqual({state:'ACCEPTED',operationId:'op'});expect(link.operations['2'].state).toBe('QUEUED');
  await service.dispatchPlanned('r',{});expect(service.call.mock.calls.filter((c:any)=>c[1]==='/v1/cargoes/create')).toHaveLength(1);
  link.operations['1'].state='SUCCESS';await service.dispatchPlanned('r',{});expect(link.operations['2'].state).toBe('ACCEPTED');
 });
 it('does not submit twice when two checks race',async()=>{
  const {service}=fixture();await Promise.all([service.dispatchPlanned('r',{}),service.dispatchPlanned('r',{})]);
  expect(service.call.mock.calls.filter((c:any)=>c[1]==='/v1/cargoes/create')).toHaveLength(1);
 });
 it('retains unknown write and refuses another dispatch',async()=>{
  const {service,link}=fixture(),original=service.call;
  service.call=vi.fn(async(...args:any[])=>{if(args[1]==='/v1/cargoes/create')throw new Error('timeout');return original(...args);});
  await expect(service.dispatchPlanned('r',{})).rejects.toThrow();expect(link.operations['1'].state).toBe('UNKNOWN');
  await service.dispatchPlanned('r',{});expect(service.call.mock.calls.filter((c:any)=>c[1]==='/v1/cargoes/create')).toHaveLength(1);
 });
 it('rejects remote cargo changes before any write',async()=>{
  const {service,link}=fixture();link.packingPlan.dispatch['1'].emptyCargoIds=['123'];
  await expect(service.dispatchPlanned('r',{})).rejects.toThrow();expect(link.operations['1'].state).toBe('QUEUED');
  expect(service.call.mock.calls.some((c:any)=>c[1]==='/v1/cargoes/create')).toBe(false);
 });
});

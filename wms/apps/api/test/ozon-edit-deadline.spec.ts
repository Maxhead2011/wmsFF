import {describe,it,expect,vi} from 'vitest';
import {OzonAssemblySupplyService} from '../src/modules/client-requests/ozon-assembly-supply.service';
import {supplyOrders,mergeSupplyOrders} from '../src/modules/client-requests/ozon-supply-policy';
// TEST: actual Ozon deadline must survive snapshot and multi-order aggregation.
describe('Ozon editing deadlines',()=>{
 it('keeps API deadline independently from slot',async()=>{
  const svc=new OzonAssemblySupplyService({} as any,{} as any);
  vi.spyOn(svc,'call').mockImplementation(async(_c,path)=>path==='/v3/supply-order/get'?{orders:[{order_id:1,order_number:'A',data_filling_deadline:'2026-10-26T15:00:00Z',timeslot:{timeslot:{from:'2026-10-26T16:00:00Z'}},supplies:[{supply_id:2}]}]}:path==='/v1/cluster/list'?{clusters:[]}:{items:[]});
  const snapshot=await svc.snapshot({id:'c'},'1');
  expect((snapshot as any).editDeadlineAt).toBe('2026-10-26T15:00:00.000Z');
  expect((supplyOrders(snapshot)[0] as any).editDeadlineAt).toBe('2026-10-26T15:00:00.000Z');
 });
 it('preserves separate deadlines and clears a removed deadline',()=>{
  const base:any={orderId:'1',supplies:[],editDeadlineAt:'old'};
  const a:any={orderId:'1',supplies:[],editDeadlineAt:null},b:any={orderId:'2',supplies:[],editDeadlineAt:'2026-10-27T10:00:00Z'};
  const result=mergeSupplyOrders(base,[a,b]);
  expect((result as any).editDeadlineAt).toBeNull();
  expect((supplyOrders(result)[1] as any).editDeadlineAt).toBe(b.editDeadlineAt);
 });
});
import {ozonEditDeadline} from '../src/modules/client-requests/ozon-supply-policy';
import {OzonFboService} from '../src/modules/ozon-fbo/ozon-fbo.service';
// TEST: absent/invalid API deadlines never inherit the delivery date or old values.
describe('deadline parsing and legacy plans',()=>{
 it('accepts explicit timezone and documented UTC alias only',()=>{
  expect(ozonEditDeadline({data_filling_deadline_utc:'2026-10-26T18:00:00+03:00'})).toBe('2026-10-26T15:00:00.000Z');
  for(const value of [null,0,'bad','2026-10-26T18:00:00'])expect(ozonEditDeadline({data_filling_deadline:value,timeslot:{from:'2026-10-26T18:00:00Z'}})).toBeNull();
 });
 it('refreshes a legacy plan without losing import metadata and exposes its deadline',async()=>{
  const plan:any={id:'p',clientId:'c',connectionId:'conn',ozonOrderId:'1',clusters:[],boxes:[],importSummary:{rows:4}};
  const db:any={ozonFboPlan:{findUnique:vi.fn(async()=>plan),update:vi.fn(async({data}:any)=>Object.assign(plan,data))}};
  const svc:any=new OzonFboService(db,{requireClientAccess(){}} as any);
  vi.spyOn(svc,'connection').mockResolvedValue({});vi.spyOn(svc,'ozonJson').mockResolvedValue({orders:[{order_id:1,data_filling_deadline:'2026-10-26T15:00:00Z',supplies:[]}]});
  const result=await svc.refreshOrder('p',{});
  expect(result.editDeadlineAt).toBe('2026-10-26T15:00:00.000Z');expect(plan.importSummary.rows).toBe(4);
  expect(svc.planSummary(plan).editDeadlineAt).toBe(result.editDeadlineAt);
  svc.ozonJson.mockResolvedValue({orders:[{order_id:1,supplies:[]}]});
  expect((await svc.refreshOrder('p',{})).editDeadlineAt).toBeNull();
 });
});

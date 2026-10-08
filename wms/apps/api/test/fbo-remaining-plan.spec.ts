import {afterEach,expect,it,vi} from 'vitest';
import {FboTwoStageService} from '../src/modules/tsd/fbo-two-stage.service';
import {loadFboFbsAvailability} from '../src/modules/tsd/fbo-fbs-reservations';
vi.mock('../src/modules/tsd/fbo-request-route',async original=>({...await original<any>(),loadFboRoutePreference:async()=>null}));
vi.mock('../src/modules/tsd/fbo-fbs-reservations',()=>({loadFboFbsAvailability:vi.fn(async()=>({free:()=>0,take:()=>{}}))}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
function fixture(phase='PICKING',complete=false){
  vi.stubEnv('WMS_RECEIPT_STOCK_INDEX_ENABLED','true');
  const units=[{id:'u1',requestItemId:'i1',skuId:'s1',state:'PICKED',sourceBoxCode:'BOX_1'},...(complete?[{id:'u2',requestItemId:'i2',skuId:'s2',state:'PACKED',sourceBoxCode:'BOX_2'}]:[])];
  const tx:any={fboAssembly:{findUnique:async()=>({phase,units,boxes:[]})},user:{findMany:async()=>[]},box:{findMany:vi.fn(async()=>[])}};
  const service:any=new FboTwoStageService(tx,{} as any,{} as any,{} as any,{} as any,{} as any);service.busyBoxes=vi.fn(async()=>new Set());
  const request:any={id:'r',clientId:'c',warehouseId:'w',client:{},items:[1,2].map(n=>({id:'i'+n,skuId:'s'+n,barcode:'code'+n,quantity:1,sku:{name:'Item'+n}}))};
  return {tx,service,request,units};
}
// TEST: picked demand must not trigger fresh warehouse reservation calculations.
it('loads stock only for the remainder while preserving picked progress',async()=>{
  const f=fixture();const plan=await f.service.snapshot(f.tx,f.request);
  expect(vi.mocked(loadFboFbsAvailability).mock.calls[0][2]).toEqual(['s2']);
  expect(plan.picked).toBe(1);expect(plan.pickedUnits[0].id).toBe('u1');
});
it.each(['PACKING','COMPLETED'])('does not construct a stock route during %s',async phase=>{
  const f=fixture(phase,true);const plan=await f.service.snapshot(f.tx,f.request);
  expect(loadFboFbsAvailability).not.toHaveBeenCalled();expect(f.tx.box.findMany).not.toHaveBeenCalled();
  expect(plan.route).toEqual([]);expect(plan.picked).toBe(2);expect(plan.packed).toBe(1);
});
it('skips empty picking demand before the phase transition',async()=>{
  const f=fixture('PICKING',true);const plan=await f.service.snapshot(f.tx,f.request);
  expect(loadFboFbsAvailability).not.toHaveBeenCalled();expect(f.tx.box.findMany).not.toHaveBeenCalled();expect(plan.shortage).toBe(0);
});
it('keeps default/sold behavior until the scoped feature is enabled',async()=>{
  const f=fixture();vi.stubEnv('WMS_RECEIPT_STOCK_INDEX_ENABLED','false');await f.service.snapshot(f.tx,f.request);
  expect(vi.mocked(loadFboFbsAvailability).mock.calls[0][2]).toEqual(['s1','s2']);
});

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

// TEST: Ozon advertises the existing parallel packer before the remaining item is picked.
it.each([true,false])('Ozon parallel capability follows the scoped flag: %s',async enabled=>{
  const f=fixture();vi.stubEnv('WMS_FBO_PARALLEL_PACKING_ENABLED',String(enabled));
  vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');
  f.tx.ozonFboShipment={findUnique:async()=>({directions:[{name:'Ozon destination',items:[{skuId:'s1',barcode:'code1',quantity:1},{skuId:'s2',barcode:'code2',quantity:1}]}]})};
  const plan=await f.service.snapshot(f.tx,f.request);
  expect(plan.parallelPackingSupported).toBe(enabled);
  expect(plan.marketplace).toBe('OZON');expect(plan.phase).toBe('PICKING');
  expect(plan.picked).toBe(1);expect(plan.needed).toBe(2);expect(plan.packed).toBe(0);
  expect(plan.directions[0].needed).toBe(2);
});

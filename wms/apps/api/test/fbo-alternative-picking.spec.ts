import {afterEach,expect,it,vi} from 'vitest';
import {FboTwoStageService} from '../src/modules/tsd/fbo-two-stage.service';
vi.mock('../src/modules/tsd/fbo-request-route',async original=>({...await original<any>(),loadFboRoutePreference:async()=>null}));
vi.mock('../src/modules/tsd/fbo-fbs-reservations',()=>({loadFboFbsAvailability:async()=>({free:(id:string)=>id==='blocked'?0:5,take:()=>{}})}));
afterEach(()=>vi.unstubAllEnvs());
function fixture(){
 vi.stubEnv('WMS_FBO_ALTERNATIVE_PICK_ENABLED','true');
 const boxes=['first','other','blocked'].map((id,i)=>({id,code:'FFL_'+id,status:'active',balances:[{skuId:'s',status:'AVAILABLE',quantity:5}],productMarks:[],storagePlacement:{pallet:{code:'PALET_SORT_'+i}}}));
 const tx:any={fboAssembly:{findUnique:async()=>({phase:'PICKING',units:[],boxes:[]})},user:{findMany:async()=>[]},box:{findMany:async()=>boxes}};
 const service:any=new FboTwoStageService(tx,{} as any,{} as any,{} as any,{} as any,{} as any);service.busyBoxes=async()=>new Set();
 const request:any={id:'r',clientId:'c',warehouseId:'w',client:{},items:[{id:'i',skuId:'s',barcode:'123',quantity:1,sku:{name:'Item',isUnmarked:true}}]};
 return {tx,service,request};
}
// TEST: a route recommendation must not reject another available source of the same remaining SKU.
it('prioritizes the scanned alternative and keeps demand unchanged',async()=>{
 const f=fixture();const original=await f.service.snapshot(f.tx,f.request);
 const next=await f.service.snapshot(f.tx,f.request,{sourceBoxCode:'FFL_other'});
 expect(original.route[0].boxCode).toBe('FFL_first');expect(next.route[0].boxCode).toBe('FFL_other');
 expect(next.alternativePickingSupported).toBe(true);expect(next.needed).toBe(1);expect(next.picked).toBe(0);expect(next.route[0].tasks[0].quantity).toBe(1);
});
it.each(['FFL_foreign','FFL_blocked'])('does not turn %s into available stock',async sourceBoxCode=>{
 const f=fixture();const p=await f.service.snapshot(f.tx,f.request,{sourceBoxCode});expect(p.route.some((r:any)=>r.boxCode===sourceBoxCode)).toBe(false);
});
it('does not bypass another active operation',async()=>{
 const f=fixture();f.service.busyBoxes=async()=>new Set(['other']);const p=await f.service.snapshot(f.tx,f.request,{sourceBoxCode:'FFL_other'});expect(p.route.some((r:any)=>r.boxCode==='FFL_other')).toBe(false);
});
it('preserves sold/default routing without the flag',async()=>{
 const f=fixture();vi.stubEnv('WMS_FBO_ALTERNATIVE_PICK_ENABLED','false');const p=await f.service.snapshot(f.tx,f.request,{sourceBoxCode:'FFL_other'});expect(p.route[0].boxCode).toBe('FFL_first');expect(p.alternativePickingSupported).not.toBe(true);
});

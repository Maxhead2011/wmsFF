import {describe,it,expect,vi,afterEach} from 'vitest';
import {WbFboSupplyService,wbFboSupplyId} from './wb-fbo-supply.service';
afterEach(()=>vi.unstubAllGlobals());
describe('WB FBO tracking',()=>{
 // TEST: supplied real URL, strict fixed marketplace ID and hostile URL rejection.
 it('extracts supply IDs without allowing arbitrary hosts or duplicate parameters',()=>{
  expect(wbFboSupplyId('https://seller.wildberries.ru/supplies-management/all-supplies/supply-detail?preorderId&supplyId=41834673&tab=uploaded-goods')).toBe('41834673');
  expect(wbFboSupplyId(' 41834673 ')).toBe('41834673');
  for(const v of ['0','-1','9007199254740992','https://evil.invalid/?supplyId=1','https://seller.wildberries.ru/?supplyId=1&supplyId=2','https://seller.wildberries.ru/?preorderId=1'])expect(()=>wbFboSupplyId(v)).toThrow();
 });
 // TEST: read-only remote request retains distinct WB gate/accepted states.
 it('reads the fixed endpoint and distinguishes gate from final acceptance',async()=>{
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({statusID:6,quantity:578,acceptedQuantity:0,warehouseName:'Test'})});vi.stubGlobal('fetch',fetch);
  const svc=new WbFboSupplyService({} as never,{} as never),result=await svc.remote({apiKey:'test'},'41834673');
  expect(result.statusId).toBe(6);expect(result.status).not.toBe('Принято');expect(result).not.toHaveProperty('gate');
  expect(fetch.mock.calls[0][0]).toBe('https://supplies-api.wildberries.ru/api/v1/supplies/41834673?isPreorderID=false');
  expect(fetch.mock.calls[0][1].method).toBeUndefined();
 });
 // TEST: unknown/broken API data must never turn into successful delivery.
 it('rejects unknown status, malformed counts and unavailable API',async()=>{
  const svc=new WbFboSupplyService({} as never,{} as never);
  for(const value of [{statusID:99,quantity:1,acceptedQuantity:1},{statusID:5,quantity:'1',acceptedQuantity:1}]){vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>value}));await expect(svc.remote({apiKey:'test'},'1')).rejects.toThrow();}
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:403}));await expect(svc.remote({apiKey:'test'},'1')).rejects.toThrow('Нет доступа');
 });
 // TEST: remote status alone never ships stock; dispatch + WB gate reuse the guarded shipment service.
 it('finalizes only a loaded, completed assembly with a confirmed WB state',async()=>{
  for(const dispatched of [false,true])for(const statusId of [3,6]){
   const before={connectionId:'c',supplyId:'1',statusId:3,quantity:2,checkedAt:'2020-01-01T00:00:00Z'};
   let stored:any=before;
   const db:any={systemSetting:{findUnique:vi.fn(async({where}:any)=>where.key.includes('dispatch')?(dispatched?{value:{at:'today'}}:null):{value:stored}),update:vi.fn(async({data}:any)=>{stored=data.value;})},$queryRaw:vi.fn(),$transaction:async(fn:any)=>fn(db)};
   const stock={shipClientRequest:vi.fn().mockResolvedValue({})};
   const svc=new WbFboSupplyService(db,{} as never,stock as never);
   vi.spyOn(svc as any,'load').mockResolvedValue({status:'PACKED',clientId:'c',items:[{quantity:2}],fboAssembly:{phase:'COMPLETED'}});
   vi.spyOn(svc as any,'connection').mockResolvedValue({apiKey:'test'});
   vi.spyOn(svc as any,'event').mockResolvedValue(undefined);
   vi.spyOn(svc,'view').mockResolvedValue({} as never);
   vi.spyOn(svc,'remote').mockResolvedValue({statusId,status:'WB',warehouse:'test',date:null,quantity:2,acceptedQuantity:0,checkedAt:new Date().toISOString()});
   await svc.refresh('r',{id:'u',permissionCodes:['client-requests:write']} as never);
   expect(stock.shipClientRequest).toHaveBeenCalledTimes(dispatched&&statusId===6?1:0);
   if(dispatched&&statusId===6)expect(stock.shipClientRequest.mock.calls[0][0]).toMatchObject({requestId:'r',idempotencyKey:'ship-request:r'});
  }
 });
});
describe('WB binding after a partial FBO pick closes',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 // TEST: regression from #2564. Original demand is retained, returns cannot enter the binding total.
 it.each([
  [1290,1290,0,true],
  [1315,1290,0,false],
  [1290,1290,1,false],
  [0,0,0,false],
 ] as const)('WB %i, packed %i, picked-only %i => binds %s',async(wb,packed,loose,allowed)=>{
  vi.stubEnv('WMS_WB_FBO_ACTUAL_BINDING_ENABLED','true');
  const groups=vi.fn().mockResolvedValue([{state:'PACKED',_count:packed},{state:'PICKED',_count:loose}]);
  const tx={fboAssemblyUnit:{groupBy:groups},$queryRaw:vi.fn(),$executeRaw:vi.fn(),systemSetting:{findUnique:vi.fn(),create:vi.fn()}};
  const svc=new WbFboSupplyService({$transaction:(fn:Function)=>fn(tx)} as never,{} as never);
  const stub=svc as any;
  vi.spyOn(stub,'load').mockResolvedValue({id:'r',clientId:'c',items:[{quantity:1315}],fboAssembly:{phase:'COMPLETED'}});
  vi.spyOn(stub,'connection').mockResolvedValue({});vi.spyOn(stub,'remote').mockResolvedValue({quantity:wb,warehouse:'Тест'});
  vi.spyOn(stub,'event').mockResolvedValue(undefined);vi.spyOn(stub,'view').mockResolvedValue({});
  const operation=svc.bind('r','conn','41663060',{id:'u'} as never);
  if(allowed)await operation;else await expect(operation).rejects.toThrow();
  expect(groups.mock.calls[0][0].where).toEqual({requestId:'r',state:{not:'RETURNED'}});
  expect(tx.systemSetting.create).toHaveBeenCalledTimes(allowed?2:0);
 });
 it('returns a retry message on HTTP 429 before opening a write transaction', async()=>{
  const db={$transaction:vi.fn()};const svc=new WbFboSupplyService(db as never,{} as never);
  vi.spyOn(svc as any,'load').mockResolvedValue({clientId:'c'});vi.spyOn(svc as any,'connection').mockResolvedValue({apiKey:'fixture'});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:429}));
  await expect(svc.bind('r','c','41663060',{} as never)).rejects.toThrow('429');expect(db.$transaction).not.toHaveBeenCalled();
 });
});

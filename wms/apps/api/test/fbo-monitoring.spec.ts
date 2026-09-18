import { afterEach, describe, expect, it, vi } from 'vitest';
import { addFboMonitoring } from '../src/modules/administration/fbo-monitoring';
import { AdministrationService } from '../src/modules/administration/administration.service';
afterEach(() => vi.unstubAllEnvs());
const device = { liveState: { screen: 'FBO_TWO_STAGE', requestId: 'r', requestNumber: 0, workerName: 'Соня' }, progress: null };
const request = { id: 'r', number: 1029, client: { name: 'Лукин' }, items: [{quantity: 5}],
  fboAssembly: { phase: 'PICKING', units: [{state: 'PICKED'}, {state:'PACKED'}], boxes: [{confirmedAt:null}, {confirmedAt:new Date()}] } };
function setup(data: unknown[] = [request]) {
 vi.stubEnv('WMS_FBO_MONITORING_ENABLED', 'true');
 const prisma = {clientRequest:{findMany:vi.fn().mockResolvedValue(data)}};
 return {prisma, read:(devices:any[]=[device])=>addFboMonitoring(prisma as never,devices,false)};
}
describe('FBO monitoring',()=>{
 // TEST: workers in the same request have separate live workflow progress.
 it('shows concurrent packing separately and preserves disabled behavior',async()=>{
  const {read}=setup();const packer={...device,liveState:{...device.liveState,fboWorkflow:'PACKING'}};
  vi.stubEnv('WMS_FBO_PARALLEL_PACKING_ENABLED','true');
  const result=await read([device,packer]);
  expect(result[0].progress.completed).toBe(2);expect(result[1].progress.completed).toBe(1);
  expect(result[1].liveState.stage).toBe('PACKING');
  vi.stubEnv('WMS_FBO_PARALLEL_PACKING_ENABLED','false');expect((await read([packer]))[0].progress.completed).toBe(2);
 });

 // TEST: exercise the actual monitor response, not only its FBO projection.
 it('includes FBO progress in the monitor response from a live TSD heartbeat',async()=>{
  const {prisma}=setup();
  Object.assign(prisma,{
   tsdOperation:{findMany:vi.fn().mockImplementation(({where})=>Promise.resolve(where.operationType==='monitor_heartbeat'?[{deviceId:'TSD-1',updatedAt:new Date(),payload:{...device.liveState,deviceCode:'TSD-1'}}]:[]))},
   fbsTsdAssembly:{findMany:vi.fn().mockResolvedValue([])},user:{findMany:vi.fn().mockResolvedValue([])},
  });
  const service=new AdministrationService(prisma as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never);
  vi.spyOn(service,'listTsdWorkloads').mockResolvedValue({checkedAt:new Date().toISOString(),summary:{registeredDevices:1,onlineDevices:1,busyDevices:0,tasks:0,protectedTasks:0},devices:[{deviceCode:'TSD-1',deviceId:'d',deviceName:null,status:null,user:null,lastSeenAt:null,online:true,workloads:[]}]} as never);
  const result=await service.listTsdMonitor({isDemo:false} as never);
  expect(result.devices[0].progress).toEqual({total:5,completed:2,remaining:3});
 });
 // TEST: the live FBO request previously had no server progress or resolved request number.
 it('resolves the current request and its picking progress without changing the worker',async()=>{
  const {read,prisma}=setup();const [d]=await read();
  expect(d.progress).toEqual({total:5,completed:2,remaining:3});
  expect(d.liveState).toMatchObject({requestNumber:1029,workerName:'Соня',screenLabel:'ФБО · Отбор товара',lastAction:'Отобрано 2 из 5 · Упаковано 1 из 5'});
  expect(prisma.clientRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:{in:['r']},client:{isDemo:false}}}));
 });
 it.each([['PACKING',5,1],['CONTROL',2,1],['COMPLETED',5,1]])('counts the correct units for %s',async(phase,total,completed)=>{
  const {read}=setup([{...request,fboAssembly:{...request.fboAssembly,phase}}]);
  expect((await read())[0].progress).toEqual({total,completed,remaining:total-completed});
 });
 it('shows an opened request before the first scan',async()=>{
  const {read}=setup([{...request,fboAssembly:null}]);
  expect((await read())[0]).toMatchObject({progress:{total:5,completed:0,remaining:5},liveState:{screenLabel:'ФБО · Ожидает начала отбора'}});
 });
 it('does not invent a request or overwrite another screen',async()=>{
  const {read,prisma}=setup();const devices=[{...device,liveState:{...device.liveState,requestId:''}},{...device,liveState:{...device.liveState,screen:'STOCK_TRANSFER'}}];
  expect(await read(devices)).toEqual(devices);expect(prisma.clientRequest.findMany).not.toHaveBeenCalled();
 });
 it('does not expose another tenant result',async()=>{const {read}=setup([]);expect(await read()).toEqual([device]);});
 it('keeps sold WMS unchanged when disabled',async()=>{
  const {read,prisma}=setup();vi.stubEnv('WMS_FBO_MONITORING_ENABLED','false');
  expect(await read()).toEqual([device]);expect(prisma.clientRequest.findMany).not.toHaveBeenCalled();
 });
});

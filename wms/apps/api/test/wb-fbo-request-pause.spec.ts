import {afterEach,describe,it,expect,vi} from 'vitest';
import {WbFboSupplyService} from '../src/modules/client-requests/wb-fbo-supply.service';
function db(){
 const state=new Map<string,any>();let tail=Promise.resolve();
 const tx:any={$queryRaw:async()=>[],systemSetting:{findUnique:async({where}:any)=>state.has(where.key)?{value:state.get(where.key)}:null,
 upsert:async({where,create,update}:any)=>{state.set(where.key,state.has(where.key)?update.value:create.value);}}};
 tx.$transaction=(fn:any)=>{const next=tail.then(()=>fn(tx));tail=next.catch(()=>{});return next;};return tx;
}
const c={clientId:'client',id:'cab',apiKey:'fixture'};
describe('WB supplies pause',()=>{
 afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});
 it('TEST: shares WB retry across supplies and service restarts without another HTTP call',async()=>{
 vi.stubEnv('WMS_WB_FBO_REQUEST_PAUSE','true');vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
 const fetch=vi.fn().mockResolvedValue(new Response('',{status:429,headers:{'X-Ratelimit-Retry':'1567'}}));vi.stubGlobal('fetch',fetch);
 const data=db();await expect(new WbFboSupplyService(data,{} as any).remote(c as any,'1')).rejects.toThrow('WB');
 await expect(new WbFboSupplyService(data,{} as any).remote(c as any,'2')).rejects.toThrow('WB');
 expect(fetch).toHaveBeenCalledTimes(1);
 });
});

import {wbFboPausedFetch,wbPauseDeadline} from '../src/modules/client-requests/wb-fbo-request-pause';
describe('pause boundaries',()=>{
 afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});
 it('TEST: honors Retry-After date and longest WB reset',()=>{
 const now=Date.parse('2026-11-05T10:00:00Z');
 expect(wbPauseDeadline(new Response('',{status:429,headers:{'Retry-After':'Thu, 05 Nov 2026 10:02:00 GMT','X-Ratelimit-Reset':'1567'}}),now)).toBe(now+1567000);
 expect(wbPauseDeadline(new Response('',{status:429,headers:{'Retry-After':'invalid'}}),now)).toBe(now+60000);
 });
 it('TEST: concurrent calls across supplies send only one request and release after expiry',async()=>{
 vi.useFakeTimers();const data=db();let resolve!:(r:Response)=>void;
 const send=vi.fn(()=>new Promise<Response>(r=>{resolve=r;}));
 const first=wbFboPausedFetch(data,'c',send);await vi.waitFor(()=>expect(send).toHaveBeenCalledTimes(1));
 await expect(wbFboPausedFetch(data,'c',send)).rejects.toThrow('уже выполняется');
 resolve(new Response('',{headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'1800'}}));await first;
 await expect(wbFboPausedFetch(data,'c',send)).rejects.toThrow('МСК');
 await wbFboPausedFetch(data,'other',async()=>new Response(''));
 vi.advanceTimersByTime(1800001);await wbFboPausedFetch(data,'c',async()=>new Response(''));
 });
 it('TEST: transport failure releases lease but prevents immediate retry',async()=>{
 vi.useFakeTimers();const data=db();await expect(wbFboPausedFetch(data,'c',async()=>{throw Error('offline')})).rejects.toThrow('offline');
 await expect(wbFboPausedFetch(data,'c',async()=>new Response(''))).rejects.toThrow('МСК');
 vi.advanceTimersByTime(10001);await expect(wbFboPausedFetch(data,'c',async()=>new Response(''))).resolves.toBeInstanceOf(Response);
 });
 it('TEST: sold installation with flag off does not access gate storage',async()=>{
 vi.stubEnv('WMS_WB_FBO_REQUEST_PAUSE','false');const fetch=vi.fn().mockResolvedValue(new Response('',{status:429}));vi.stubGlobal('fetch',fetch);
 await expect(new WbFboSupplyService({} as any,{} as any).remote(c as any,'1')).rejects.toThrow('HTTP 429');expect(fetch).toHaveBeenCalledTimes(1);
 });
});

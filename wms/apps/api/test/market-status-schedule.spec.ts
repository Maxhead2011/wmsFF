import {describe,it,expect,vi} from 'vitest';
import {marketStatusSlot,claimMarketSlot,finishMarketSlot} from '../src/modules/client-requests/market-status-schedule';
// TEST: fixed Moscow wall-clock, restart deduplication, failed requests and stale workers.
describe('marketplace schedule',()=>{
 it.each([[4,59,null],[5,0,'08'],[8,59,'08'],[9,0,'12'],[12,0,'15'],[15,0,'18'],[18,0,'21'],[20,59,'21'],[21,0,null]])('UTC %s:%s => Moscow slot %s',(h,m,expected)=>{
  const value=marketStatusSlot(new Date(Date.UTC(2026,10,10,h,m)));
  expect(value).toBe(expected?`2026-11-10T${expected}:00+03:00`:null);
 });
 function db(){let value:any;const tx:any={$queryRaw:vi.fn(),systemSetting:{findUnique:vi.fn(async()=>value?{value}:null),upsert:vi.fn(async(x:any)=>{value=x.update.value;}),update:vi.fn(async(x:any)=>{value=x.data.value;})}};return {...tx,$transaction:(f:any)=>f(tx),value:()=>value};}
 it('claims once, skips a running worker and persists completion across restart',async()=>{const d=db();const c=await claimMarketSlot(d,'r','slot',100);expect(c).toBeTruthy();expect(await claimMarketSlot(d,'r','slot',200)).toBeNull();await finishMarketSlot(d,'r',c,true,'PACKED',300);expect(await claimMarketSlot(d,'r','slot',999999)).toBeNull();expect(await claimMarketSlot(d,'r','next',999999)).toBeTruthy();});
 it('retries failures with backoff and rejects a stale completion',async()=>{const d=db();const c=await claimMarketSlot(d,'r','slot',100);await finishMarketSlot(d,'r',c,false,'429',200);expect(await claimMarketSlot(d,'r','slot',201)).toBeNull();const newer=await claimMarketSlot(d,'r','slot',400000);expect(newer).toBeTruthy();await finishMarketSlot(d,'r',c,true,'DONE',400100);expect(d.value().token).toBe(newer.token);});
});

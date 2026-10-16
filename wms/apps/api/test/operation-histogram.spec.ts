import { expect, it, vi } from 'vitest';
import { createOperationHistogram } from '../src/common/diagnostics/operation-histogram';

// TEST: unlike sampled detail logs, shift summaries must count every completed response.
it('counts all requests and merges latency buckets without recording identities', () => {
  let now=1000;const log=vi.fn();const h=createOperationHistogram(log,()=>now);
  for(let i=0;i<999;i++)h.record({operation:'POST /scan',durationMs:20,failed:false});
  h.record({operation:'POST /scan',durationMs:1200,failed:true,statusCode:500});
  now=61000;h.flush();const output=log.mock.calls[0][0];
  expect(output.rows[0]).toMatchObject({count:1000,failed:1,serverErrors:1,maxMs:1200});
  expect(output.rows[0].buckets.reduce((a:number,b:number)=>a+b,0)).toBe(1000);
  expect(output.rows[0].buckets[1]).toBe(999);
  expect(JSON.stringify(output)).not.toMatch(/traceId|token|body/);
  h.flush();expect(log).toHaveBeenCalledTimes(2);expect(log.mock.calls[1][0].rows).toEqual([]);
});

it('bounds route cardinality and retains overflow counts',()=>{
 const log=vi.fn(),h=createOperationHistogram(log,()=>10);
 for(let i=0;i<300;i++)h.record({operation:'GET /route'+i,durationMs:2,failed:false});
 h.flush();const rows=log.mock.calls[0][0].rows;
 expect(rows.length).toBe(129);expect(rows.reduce((n:number,r:any)=>n+r.count,0)).toBe(300);
 expect(rows.find((r:any)=>r.operation==='overflow').count).toBe(172);
});

it('isolates logger failure and starts a fresh window',()=>{
 let now=0;const log=vi.fn().mockImplementationOnce(()=>{throw Error('logger');});const h=createOperationHistogram(log,()=>now);
 h.record({operation:'GET /safe',durationMs:10,failed:false});expect(()=>h.flush()).not.toThrow();
 now=60000;h.record({operation:'GET /safe',durationMs:200,failed:false,statusCode:400});h.flush();
 expect(log.mock.calls[1][0].rows[0]).toMatchObject({count:1,clientErrors:1});
});

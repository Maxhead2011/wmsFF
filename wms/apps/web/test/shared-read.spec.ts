import {expect,it,vi} from 'vitest';
import {createSharedRead} from '../src/lib/shared-read';
// TEST: opening and polling the same request must not start two calculations.
it('joins pending reads, but starts fresh after completion',async()=>{
 const read=createSharedRead(),load=vi.fn(async()=>({count:1}));
 const a=read('user:warehouse:request',load),b=read('user:warehouse:request',load);
 expect(a).toBe(b);await a;expect(load).toHaveBeenCalledOnce();
 await read('user:warehouse:request',load);expect(load).toHaveBeenCalledTimes(2);
});
it('does not share between sessions and retries errors',async()=>{
 const read=createSharedRead(),load=vi.fn(async()=>{throw Error('offline');});
 await Promise.allSettled([read('session-a',load),read('session-b',load)]);
 expect(load).toHaveBeenCalledTimes(2);
 await expect(read('session-a',load)).rejects.toThrow('offline');expect(load).toHaveBeenCalledTimes(3);
});

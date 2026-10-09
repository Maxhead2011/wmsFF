import { expect,it,vi } from 'vitest';
import { leanInstructionCatalog } from '../src/modules/stock/menu-read-catalog';
// TEST: payload projection must start without waiting for the independent SKU query.
it('reads independent catalogue projections concurrently and joins by id',async()=>{
 let resolve!:(v:any)=>void;const rows=new Promise(r=>resolve=r);
 const query=vi.fn().mockResolvedValue([{id:'s',payload:{size:'M'}}]);
 const pending=leanInstructionCatalog({sku:{findMany:()=>rows},$queryRaw:query} as any,'c');
 expect(query).toHaveBeenCalledTimes(1);
 resolve([{id:'s',barcodes:[]}]);expect(await pending).toEqual([{id:'s',barcodes:[],marketplacePayload:{size:'M'}}]);
});

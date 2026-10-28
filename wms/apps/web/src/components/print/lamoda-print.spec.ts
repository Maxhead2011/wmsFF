import { afterEach, expect, it, vi } from 'vitest';
import { fetchSkus } from '../../lib/api';
afterEach(()=>vi.unstubAllGlobals());
// TEST: only the print caller opts in; inventory still receives warehouse barcodes only.
it('sends the explicit print flag and retains Lamoda barcode text including leading zero',async()=>{
 const rows=[{id:'s',barcodes:[{id:'lm',value:'04640684262439',isPrimary:false,source:'LAMODA'}]}];
 const call=vi.fn(async(_url:string,_init?:RequestInit)=>new Response(JSON.stringify(rows),{status:200}));vi.stubGlobal('fetch',call);
 expect(await fetchSkus('token',{clientId:'c',search:'04640684262439',forPrint:true})).toEqual(rows);
 expect(String(call.mock.calls[0][0])).toContain('forPrint=true');
 await fetchSkus('token',{clientId:'c'});
 expect(String(call.mock.calls[1][0])).not.toContain('forPrint');
});

import { afterEach, expect, it, vi } from 'vitest';
import { fetchFbsProductReserve } from '../../lib/api';
afterEach(()=>vi.unstubAllGlobals());
// TEST: the allocation policy can have no shares/analysis while its SKU reserve remains editable.
it('loads the explicit SKU rule without allocation analysis and retains its version/block',async()=>{
 const row={skuId:'one',blocked:true,reserveOverride:{mode:'UNITS',value:2},ruleUpdatedAt:'version'};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({analysis:null,reserveRows:[row]}))));
 expect((await fetchFbsProductReserve('token','client','connection','one')).row).toEqual(row);
});
// TEST: absence or malformed metadata must never become a writable default rule.
it.each([{analysis:null,reserveRows:[]},{reserveRows:[{skuId:'one',reserveOverride:null,ruleUpdatedAt:null}]}])('rejects missing or incomplete rule metadata',async body=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
 await expect(fetchFbsProductReserve('token','client','connection','one')).rejects.toThrow();
});

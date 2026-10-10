import { afterEach, expect, it, vi } from 'vitest';
import { confirmProductLink, fetchProductLinks, type ProductLinkRow } from './api';
afterEach(()=>vi.unstubAllGlobals());
// TEST: account scoping and optimistic version are preserved by the real transport.
it('sends the chosen physical SKU, reason and version to the selected account only',async()=>{
 const mock=vi.fn().mockResolvedValue({ok:true,json:async()=>({linked:true})});vi.stubGlobal('fetch',mock);
 const row={id:'row',updatedAt:'2026-10-10T10:00:00.000Z'} as ProductLinkRow;
 await confirmProductLink('token','account',row,'physical-sku','Checked barcode');
 const [url,options]=mock.mock.calls[0];expect(url).toMatch(/\/account\/product-links\/row\/confirm$/);
 expect(options.headers.Authorization).toBe('Bearer token');
 expect(JSON.parse(options.body)).toEqual({skuId:'physical-sku',updatedAt:row.updatedAt,reason:'Checked barcode'});
});
it('propagates a failed review rather than reporting success',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:409,json:async()=>({message:'Refresh review'})}));
 await expect(fetchProductLinks('token','account')).rejects.toThrow('Refresh review');
});

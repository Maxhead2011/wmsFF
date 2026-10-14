import {afterEach,expect,it,vi} from 'vitest';
import {previewOzonLinks,createOzonLinks,fetchOzonLinkConnections} from './api';
afterEach(()=>vi.unstubAllGlobals());
// TEST: preview and creation carry the same explicit client, account and warehouse.
it('preserves the selected branch and account in both link-import requests',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);
 const body={clientId:'second-client',connectionId:'second-account',warehouseId:'moscow',links:'https://seller.ozon.ru/app/supply/orders/123',previewHash:'hash'};
 await previewOzonLinks('token',body);await createOzonLinks('token',body);
 for(const [,options] of fetch.mock.calls)expect(JSON.parse(options.body)).toEqual(body);
});
it('propagates account loading failure instead of returning an empty list',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:403,json:async()=>({message:'Нет доступа'})}));
 await expect(fetchOzonLinkConnections('token','client')).rejects.toThrow('Нет доступа');
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { YandexFbyClient } from '../src/modules/yandex-fby/yandex-fby-client';
import { fbyQueueScope } from '../src/modules/yandex-fby/yandex-fby-scope';
const c={sellerId:'123',apiKey:'secret'};
const response=(result:unknown)=>Response.json({status:'OK',result});
// TEST: export catalogue is campaign-bound, complete, paginated and read-only.
it('loads the selected campaign business catalogue across all pages',async()=>{
 const http=vi.fn().mockResolvedValueOnce(Response.json({campaign:{id:123,business:{id:9}}}))
 .mockResolvedValueOnce(response({offerMappings:[{offer:{offerId:'a',name:'A',barcodes:['001']}}],paging:{nextPageToken:'two'}}))
 .mockResolvedValueOnce(response({offerMappings:[{offer:{offerId:'b',name:'B',barcodes:['002']}}]}));
 expect((await new YandexFbyClient(http).offers(c)).map(o=>o.offerId)).toEqual(['a','b']);
 expect(http.mock.calls[0][1].method).toBe('GET');expect(http.mock.calls[1][0]).toContain('businesses/9/offer-mappings');expect(http.mock.calls[2][0]).toContain('pageToken=two');
});
it('rejects foreign campaigns, partial catalogues and duplicate pages without exposing credentials',async()=>{
 const wrong=vi.fn(async()=>Response.json({campaign:{id:456,business:{id:9}}}));await expect(new YandexFbyClient(wrong).offers(c)).rejects.toThrow('кампании');
 const http=vi.fn().mockResolvedValueOnce(Response.json({campaign:{id:123,business:{id:9}}})).mockImplementation(async()=>response({offerMappings:[{offer:{offerId:'a'}}],paging:{nextPageToken:'again'}}));
 await expect(new YandexFbyClient(http).offers(c)).rejects.toThrow('повторный');
 const denied=vi.fn(async()=>Response.json({secret:c.apiKey},{status:403}));await expect(new YandexFbyClient(denied).offers(c)).rejects.toThrow('Просмотр товаров');
});
afterEach(()=>vi.unstubAllEnvs());
// TEST: cabinet identity, pagination and no credential/error leakage.
describe('Yandex FBY reader',()=>{
 it('finds a cabinet number on later pages without mistaking API ID for the number',async()=>{
  const http=vi.fn().mockResolvedValueOnce(response({requests:[{id:{id:77,marketplaceRequestId:'other'}}],paging:{nextPageToken:'next'}}))
   .mockResolvedValueOnce(response({requests:[{id:{id:55,marketplaceRequestId:'77'}}]}));
  const result=await new YandexFbyClient(http).supply(c,'77');expect(result.id.id).toBe(55);
  expect(new URL(http.mock.calls[1][0]).searchParams.get('pageToken')).toBe('next');
  expect(http.mock.calls[0][1].headers['Api-Key']).toBe('secret');
  expect(String(http.mock.calls[0][0])).not.toContain('secret');
 });
 it('fails closed on a repeated page token',async()=>{
  const http=vi.fn(async()=>response({items:[{offerId:'a',counters:{planCount:2}}],paging:{nextPageToken:'same'}}));
  await expect(new YandexFbyClient(http).items(c,1)).rejects.toThrow('повторил страницу');expect(http).toHaveBeenCalledTimes(2);
 });
 it('rejects duplicate offers and fractional demand',async()=>{
  for(const items of [[{offerId:'a',counters:{planCount:1.5}}],[{offerId:'a',counters:{planCount:1}},{offerId:'a',counters:{planCount:1}}]])
   await expect(new YandexFbyClient(vi.fn(async()=>response({items}))).items(c,1)).rejects.toThrow();
 });
 it('does not expose upstream bodies or retry rate limits',async()=>{
  const http=vi.fn(async()=>Response.json({secret:'credential'}, {status:429}));
  await expect(new YandexFbyClient(http).items(c,1)).rejects.toThrow('частоту');expect(http).toHaveBeenCalledTimes(1);
 });
 it('keeps FBY outside old client queues and does not query its relation on sold WMS',()=>{
  vi.stubEnv('WMS_YANDEX_FBY_ENABLED','false');expect(fbyQueueScope('WB')).toEqual({});expect(()=>fbyQueueScope('YANDEX_MARKET')).toThrow();
  vi.stubEnv('WMS_YANDEX_FBY_ENABLED','true');
  for(const market of [undefined,'WB','OZON'])expect(fbyQueueScope(market)).toEqual({yandexFbyShipment:{is:null}});
  expect(fbyQueueScope('YANDEX_MARKET')).toEqual({yandexFbyShipment:{isNot:null}});
 });
});

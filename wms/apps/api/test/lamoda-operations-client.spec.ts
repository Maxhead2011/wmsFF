import { afterEach, expect, it, vi } from 'vitest';
import { LamodaClient } from '../src/modules/lamoda/lamoda-client';
import { prepareLamodaCommand } from '../src/modules/lamoda/lamoda-commands';
const c={sellerId:'seller',oauthClientId:'client',secret:'secret'};
const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
const token=()=>response({access_token:'token',expires_in:3600,token_type:'Bearer'});
afterEach(()=>vi.unstubAllEnvs());
// TEST: contract validation covers every supported mutation, including FBO price/date.
it.each([
 ['PACKS',{count:1},'/orders/order/packs'],
 ['ASSEMBLY',{packs:[{itemIds:['item']}]},'/orders/order/assembly'],
 ['FBO_CANCEL',{cancelReason:'ACTUALITY'},'/fbo/shipments/shipment/cancel'],
 ['FBO_CREATE',{externalShipmentId:'local',warehouseCode:'warehouse',plannedDate:'2026-11-01',items:[{externalSku:'sku',quantity:1,price:{amount:100,currency:'RUB'}}]},'/fbo/shipments'],
 ['FBS_CREATE',{shipAt:'2026-11-01T09:00:00Z',pallets:[{packs:[{packId:'pack',items:[{unitload:'item'}]}]}]},'/fbs/shipments'],
] as const)('validates %s against pinned contract', (kind,body,path)=>{
 const result=prepareLamodaCommand({kind,body:body as any,orderId:'order',shipmentId:'shipment'},'seller');
 expect(result.path).toBe(path); expect(JSON.parse(result.body).sellerId).toBe('seller');
});
it('rejects impossible FBO dates and path traversal before network access',()=>{
 expect(()=>prepareLamodaCommand({kind:'FBO_CREATE',body:{externalShipmentId:'x',warehouseCode:'w',plannedDate:'2026-02-30',items:[{externalSku:'s',quantity:1,price:{amount:1,currency:'RUB'}}]}},'s')).toThrow('INVALID_COMMAND');
 for(const orderId of ['..','x/y','x?other=1','']) expect(()=>prepareLamodaCommand({kind:'PACKS',orderId,body:{count:1}},'s')).toThrow('INVALID_COMMAND');
});
it.each([new Response('not JSON'),new Response('{}',{status:408}),new Response('{}',{status:409})])('never retries malformed or ambiguous responses',async reply=>{
 vi.stubEnv('WMS_LAMODA_EXTERNAL_WRITES_ENABLED','true');
 const http=vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(reply);
 await expect(new LamodaClient(http).execute(c,{kind:'PACKS',orderId:'order',body:{count:1}})).rejects.toMatchObject({outcome:'UNKNOWN'});
 expect(http).toHaveBeenCalledTimes(2);
});
// TEST: a write gate must fail before authentication or any network traffic.
it('blocks operational writes until explicitly enabled',async()=>{
 const http=vi.fn();const client=new LamodaClient(http);
 await expect(client.execute(c,{kind:'STOCKS',body:{data:[{sku:'s',quantity:1}]}})).rejects.toThrow('WRITES_DISABLED');
 expect(http).not.toHaveBeenCalled();
});
// TEST: a timeout may mean a committed operation; never send it again automatically.
it('reports an uncertain result without retrying business writes',async()=>{
 vi.stubEnv('WMS_LAMODA_EXTERNAL_WRITES_ENABLED','true');
 const http=vi.fn().mockResolvedValueOnce(token()).mockRejectedValueOnce(new Error('secret'));
 await expect(new LamodaClient(http).execute(c,{kind:'STOCKS',body:{data:[{sku:'s',quantity:1}]}})).rejects.toMatchObject({outcome:'UNKNOWN'});
 expect(http).toHaveBeenCalledTimes(2);
});
it('uses official stock contract and cannot override seller identity',async()=>{
 vi.stubEnv('WMS_LAMODA_EXTERNAL_WRITES_ENABLED','true');
 const http=vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(response({data:[{sku:'s',quantity:0}]},201));
 await new LamodaClient(http).execute(c,{kind:'STOCKS',body:{data:[{sku:'s',quantity:0}]}});
 expect(http.mock.calls[1][0]).toBe('https://public-api-seller.lamoda.ru/api/v2/fbs/stocks');
 expect(JSON.parse(http.mock.calls[1][1].body)).toEqual({sellerId:'seller',data:[{sku:'s',quantity:0}]});
});
it.each([400,401,403,404,429])('classifies HTTP %s as a definite rejection without repeating it',async status=>{
 vi.stubEnv('WMS_LAMODA_EXTERNAL_WRITES_ENABLED','true');
 const http=vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(response({secret:'hidden'},status));
 await expect(new LamodaClient(http).execute(c,{kind:'PACKS',orderId:'order',body:{count:1}})).rejects.toMatchObject({outcome:'REJECTED',status});
 expect(http).toHaveBeenCalledTimes(2);
});
it.each([500,502,503])('classifies HTTP %s as uncertain',async status=>{
 vi.stubEnv('WMS_LAMODA_EXTERNAL_WRITES_ENABLED','true');
 const http=vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(response({},status));
 await expect(new LamodaClient(http).execute(c,{kind:'PACKS',orderId:'order',body:{count:1}})).rejects.toMatchObject({outcome:'UNKNOWN'});
});
it('rejects invalid and foreign fields before sending',async()=>{
 vi.stubEnv('WMS_LAMODA_EXTERNAL_WRITES_ENABLED','true');
 const http=vi.fn(),client=new LamodaClient(http);
 for(const body of [{data:[{sku:'s',quantity:-1}]},{data:[{sku:'s',quantity:1}],sellerId:'other'},{data:Array.from({length:101},()=>({sku:'s',quantity:1}))}]){
  await expect(client.execute(c,{kind:'STOCKS',body})).rejects.toThrow('INVALID_COMMAND');
 }expect(http).not.toHaveBeenCalled();
});
it('downloads PDF pack labels with seller scope and rejects HTML',async()=>{
 const pdf=Buffer.from('%PDF-1.4\nfixture');
 const http=vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response(pdf,{headers:{'Content-Type':'application/pdf'}}));
 expect(await new LamodaClient(http).packLabel(c,'order','pack','M')).toEqual(pdf);
 expect(http.mock.calls[1][0]).toContain('/orders/order/packs/pack/label?sellerId=seller&labelFormat=M');
 const bad=vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response('<html/>',{headers:{'Content-Type':'text/html'}}));
 await expect(new LamodaClient(bad).packLabel(c,'order','pack','M')).rejects.toThrow('INVALID_PDF');
});

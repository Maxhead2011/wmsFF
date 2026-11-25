import {afterEach,describe,it,expect,vi} from 'vitest';
import {MarketplaceConnectionsService} from '../src/modules/marketplace-connections/marketplace-connections.service';

const selected=[{connectionId:'ozon',id:'13716543-0718-2'}];
function fixture(marketplace='OZON') {
 const db={clientMarketplaceConnection:{findMany:vi.fn(async()=>[{id:'ozon',marketplace,sellerId:'seller',apiKey:'secret',accountName:'cabinet'}])}};
 const service:any=new MarketplaceConnectionsService(db as any,{} as any);
 service.resolveSelectedFbsOrders=vi.fn(async()=>{throw Error('Full client refresh must not run');});
 return {db,service};
}
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('selected Ozon label metadata',()=>{
 // TEST: previously printing even one Ozon order entered the full client refresh.
 it('reads only the selected posting, deduplicates it and never refreshes all orders',async()=>{
  vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED','true');
  const {db,service}=fixture();
  const fetch=vi.fn(async()=>new Response(JSON.stringify({result:{posting_number:selected[0].id,status:'awaiting_deliver',products:[{quantity:1}]}}),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetch);
  const result=await service.resolveFbsLabelOrders('client',[...selected,...selected]);
  expect(result.orders).toHaveLength(1);expect(result.orders[0]).toMatchObject({...selected[0],marketplace:'OZON',supplierStatus:'awaiting_deliver'});
  expect(service.resolveSelectedFbsOrders).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe('https://api-seller.ozon.ru/v3/posting/fbs/get');
  expect(JSON.parse((fetch.mock.calls[0] as any)[1].body)).toEqual({posting_number:selected[0].id});
  expect(db.clientMarketplaceConnection.findMany.mock.calls[0][0]).toMatchObject({where:{clientId:'client',isActive:true,id:{in:['ozon']}}});
 });
 // TEST: a missing/foreign cabinet must fail before any seller API call.
 it('rejects a cabinet outside the client without calling a marketplace or full refresh',async()=>{
  vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED','true');const {db,service}=fixture();db.clientMarketplaceConnection.findMany.mockResolvedValue([]);
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(service.resolveFbsLabelOrders('client',selected)).rejects.toThrow('кабинета');expect(fetch).not.toHaveBeenCalled();expect(service.resolveSelectedFbsOrders).not.toHaveBeenCalled();
 });
 // TEST: preserve the disabled-feature path used by other deployments.
 it('keeps the existing resolver when the own-WMS feature is disabled',async()=>{
  vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED','false');const {db,service}=fixture();service.resolveSelectedFbsOrders.mockResolvedValue({orders:[]});
  await service.resolveFbsLabelOrders('client',selected);expect(service.resolveSelectedFbsOrders).toHaveBeenCalledWith('client',selected);expect(db.clientMarketplaceConnection.findMany).not.toHaveBeenCalled();
 });
 // TEST: current identity and status are mandatory; do not print a stale/cancelled posting.
 it.each([{posting_number:'other',status:'awaiting_deliver'},{posting_number:selected[0].id,status:'cancelled'}])('rejects incompatible live posting %j',async result=>{
  vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED','true');const {service}=fixture();vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({result}),{headers:{'content-type':'application/json'}})));
  await expect(service.resolveFbsLabelOrders('client',selected)).rejects.toThrow();expect(service.resolveSelectedFbsOrders).not.toHaveBeenCalled();
 });
});

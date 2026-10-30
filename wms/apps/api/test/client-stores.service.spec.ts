import {afterEach,describe,it,expect,vi} from 'vitest';
import {ClientStoresService} from '../src/modules/clients/client-stores.service';
const stores=[{id:'monlarti',name:'Монларти',connectionIds:['m-wb','m-ozon']},{id:'braibo',name:'Брайбо',connectionIds:['b-wb']}];
function setup(){
 vi.stubEnv('WMS_CLIENT_STORES_ENABLED','true');
 const db:any={sku:{findFirst:vi.fn().mockResolvedValue({id:"shared"})},client:{findFirst:vi.fn().mockResolvedValue({id:'c'})},systemSetting:{findUnique:vi.fn().mockResolvedValue({value:stores}),upsert:vi.fn()},
 clientMarketplaceConnection:{findMany:vi.fn().mockResolvedValue(['m-wb','m-ozon','b-wb'].map(id=>({id})))},auditLog:{create:vi.fn()},$executeRaw:vi.fn()};
 db.$transaction=(fn:any)=>fn(db);
 const scopes={requireClientAccess:vi.fn()};
 const user:any={id:'u',roleCodes:['OWNER'],isDemo:false};
 return {db,scopes,user,service:new ClientStoresService(db,scopes as never)};
}
// TEST: shop metadata must not widen client/branch scope or mutate stock and reservations.
describe('client store directory',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('keeps sold WMS payload unchanged and performs no reads when disabled',async()=>{
  const {service,db,user}=setup();vi.stubEnv('WMS_CLIENT_STORES_ENABLED','false');
  const response={connections:[],orders:[]};expect(await service.decorateOrders('c',response,user)).toBe(response);
  expect(db.client.findFirst).not.toHaveBeenCalled();
 });
 it('decorates only already-visible connections and preserves original order identity',async()=>{
  const {service,user}=setup();const source={connections:[{id:'m-wb'}],orders:[{id:'o',connectionId:'m-wb',quantity:1}]};
  const result:any=await service.decorateOrders('c',source,user);
  expect(result.stores).toEqual([{...stores[0],connectionIds:['m-wb']}]);
  expect(result.orders[0]).toMatchObject({id:'o',quantity:1,storeId:'monlarti'});
  expect(source.orders[0]).not.toHaveProperty('storeId');
 });
 it('checks client permissions before reading settings',async()=>{
  const {service,scopes,db,user}=setup();scopes.requireClientAccess.mockImplementation(()=>{throw new Error('forbidden');});
  await expect(service.get('other',user)).rejects.toThrow('forbidden');expect(db.systemSetting.findUnique).not.toHaveBeenCalled();
 });
 it('does not permit client managers to change seller bindings',async()=>{
  const {service,db,user}=setup();user.roleCodes=['CLIENT'];await expect(service.save('c',stores,user)).rejects.toThrow('администратор');
  expect(db.systemSetting.upsert).not.toHaveBeenCalled();
 });
 it('refuses moving an established connection between stores',async()=>{
  const {service,db,user}=setup();await expect(service.save('c',[{...stores[0],connectionIds:['m-wb']},{...stores[1],connectionIds:['b-wb','m-ozon']}],user)).rejects.toThrow('сверки истории');
  expect(db.systemSetting.upsert).not.toHaveBeenCalled();
 });
 it('audits a permitted name update without changing client or stock',async()=>{
  const {service,db,user}=setup();await service.save('c',[{...stores[0],name:'Монларти новый'},stores[1]],user);
  expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:'CLIENT_STORES_SAVED',entityId:'c'})}));
 });
 // TEST: shared eligibility is additive and cannot overwrite another administrator's changes.
 it('saves two store permissions on one SKU without creating inventory',async()=>{
  const {service,db,user}=setup();db.systemSetting.findUnique.mockImplementation(async({where}:any)=>where.key.startsWith('client.stores.')?{value:stores}:null);
  expect(await service.saveSkuStores('c','shared',['monlarti','braibo'],[],user)).toMatchObject({skuId:'shared',storeIds:['braibo','monlarti']});
  expect(db.sku.findFirst).toHaveBeenCalledWith({where:{id:'shared',clientId:'c'},select:{id:true}});
  expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:'SKU_STORES_SAVED'})}));
 });
 it('rejects stale membership edits and removals',async()=>{
  const {service,db,user}=setup();db.systemSetting.findUnique.mockImplementation(async({where}:any)=>({value:where.key.startsWith('client.stores.')?stores:['monlarti']}));
  await expect(service.saveSkuStores('c','shared',['monlarti','braibo'],[],user)).rejects.toThrow('Связи изменились');
  await expect(service.saveSkuStores('c','shared',['braibo'],['monlarti'],user)).rejects.toThrow('резервов');
  expect(db.systemSetting.upsert).not.toHaveBeenCalled();
 });
 it('rejects membership changes for another client SKU',async()=>{
  const {service,db,user}=setup();db.sku.findFirst.mockResolvedValue(null);
  await expect(service.saveSkuStores('c','foreign',['monlarti'],[],user)).rejects.toThrow('Товар клиента');
  expect(db.systemSetting.upsert).not.toHaveBeenCalled();
 });

});

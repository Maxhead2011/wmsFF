import {afterEach,it,expect,vi} from 'vitest';
import {OzonLinkImportService,ozonLinkIds} from '../src/modules/client-requests/ozon-link-import.service';
import {ClientScopeService} from '../src/modules/auth/client-scope.service';
import {OzonFboImportService} from '../src/modules/client-requests/ozon-fbo-import.service';
const user={id:'u',roleCodes:[],permissionCodes:['system:admin'],activeWarehouseId:'w'} as any;
const body={clientId:'c',connectionId:'conn',links:'https://seller.ozon.ru/app/supply/orders/123'};
afterEach(()=>vi.unstubAllEnvs());
function setup(){
 vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');
 const db:any={warehouseClient:{findMany:vi.fn().mockResolvedValue([{warehouseId:'w',warehouse:{name:'Moscow'}}]),findFirst:vi.fn().mockResolvedValue({})},clientMarketplaceConnection:{findFirst:vi.fn().mockResolvedValue({id:'conn',sellerId:'seller',apiKey:'test'})},ozonFboPlan:{findFirst:vi.fn().mockResolvedValue(null)},ozonFboOrderBinding:{findMany:vi.fn().mockResolvedValue([]),createMany:vi.fn()},ozonFboShipment:{findMany:vi.fn().mockResolvedValue([]),findUnique:vi.fn().mockResolvedValue(null),update:vi.fn()},clientRequest:{create:vi.fn().mockResolvedValue({id:'r',number:1952}),update:vi.fn(),findUniqueOrThrow:vi.fn().mockResolvedValue({id:'r',number:1952,clientId:'c',warehouseId:'w'})},client:{findUniqueOrThrow:vi.fn().mockResolvedValue({storesWithoutBoxes:false})},barcode:{findMany:vi.fn().mockResolvedValue([{value:'2048701988171',skuId:'sku',sku:{name:'Пульт'}}])},auditLog:{create:vi.fn()},$queryRaw:vi.fn(),$executeRaw:vi.fn()};db.$transaction=vi.fn(fn=>fn(db));
 const link:any={connectionId:'conn',orderId:'123',orderNumber:'123-1',place:'Москва',date:'2026-10-13T09:00:00Z',state:'DATA_FILLING',checkedAt:'now',mapping:{},operations:{},supplies:[{id:'s1',name:'Воронеж',items:[{barcode:'2048701988171',offerId:'a',quantity:10,quant:1}]}]};
 const supply={snapshot:vi.fn().mockImplementation(async(_c,id)=>({...link,orderId:id,supplies:link.supplies.map((s:any)=>({...s,id:s.id+id}))}))};
 const scopes={requireClientAccess:vi.fn()},importer=new OzonFboImportService(db,scopes as any);return {db,link,supply,scopes,service:new OzonLinkImportService(db,scopes as any,importer,supply as any)};
}
// TEST: links create one scoped assembly only after preview, with no Ozon write calls.
it('validates URLs and deduplicates IDs',()=>{expect(ozonLinkIds(body.links+'?tab=items '+body.links)).toEqual(['123']);for(const x of ['http://seller.ozon.ru/app/supply/orders/123','https://evil.test/123',''])expect(()=>ozonLinkIds(x)).toThrow();});
it('previews read-only, creates demand and binding together',async()=>{const s=setup(),p=await s.service.preview(body,user);expect(p.totalQuantity).toBe(10);expect(s.db.$transaction).not.toHaveBeenCalled();await s.service.commit({...body,previewHash:p.previewHash},user);expect(s.db.clientRequest.create).toHaveBeenCalledTimes(1);expect(s.db.ozonFboOrderBinding.createMany).toHaveBeenCalledWith({data:[{externalOrderKey:'seller:123',requestId:'r',orderId:'123'}]});});
it('rejects stale preview',async()=>{const s=setup(),p=await s.service.preview(body,user);s.link.supplies[0].items[0].quantity=9;await expect(s.service.commit({...body,previewHash:p.previewHash},user)).rejects.toThrow('изменился');expect(s.db.$transaction).not.toHaveBeenCalled();});
it('returns existing and rejects partial overlap',async()=>{const s=setup(),p=await s.service.preview(body,user);s.db.ozonFboOrderBinding.findMany.mockResolvedValue([{requestId:'r'}]);s.db.ozonFboShipment.findUnique.mockResolvedValue({integration:s.link});expect((await s.service.commit({...body,previewHash:p.previewHash},user)).existing).toBe(true);expect(s.db.clientRequest.create).not.toHaveBeenCalled();await expect(s.service.preview({...body,links:body.links+' '+body.links.replace('123','124')},user)).rejects.toThrow('Часть ссылок');});
it('rejects missing SKU, denied client and disabled feature',async()=>{const s=setup();s.db.barcode.findMany.mockResolvedValue([]);await expect(s.service.preview(body,user)).rejects.toThrow('не найден');s.scopes.requireClientAccess.mockImplementation(()=>{throw Error('denied');});await expect(s.service.preview(body,user)).rejects.toThrow('denied');vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','false');await expect(s.service.preview(body,user)).rejects.toThrow('выключен');expect(s.db.$transaction).not.toHaveBeenCalled();});
it('separates duplicate destination names from different orders',async()=>{const s=setup(),p=await s.service.preview({...body,links:body.links+' '+body.links.replace('123','124')},user);expect(p.totalQuantity).toBe(20);expect(new Set(p.directions.map(d=>d.name)).size).toBe(2);});
it('retries transaction serialization collision',async()=>{const s=setup(),p=await s.service.preview(body,user);s.db.$transaction.mockRejectedValueOnce({code:'P2034'});await s.service.commit({...body,previewHash:p.previewHash},user);expect(s.db.$transaction).toHaveBeenCalledTimes(2);expect(s.db.clientRequest.create).toHaveBeenCalledTimes(1);});

// TEST: one customer manages two legal entities without an internal active branch.
for (const clientId of ['c','second']) it(`customer can preview and create for ${clientId} without activeWarehouseId`,async()=>{
 const s=setup();const customer={...user,roleCodes:['CLIENT'],permissionCodes:[],activeWarehouseId:null,clientScopeMode:'LIMITED',clientIds:['c','second'],writableClientIds:['c','second']} as any;
 s.scopes.requireClientAccess.mockImplementation((u,id)=>{if(!u.writableClientIds.includes(id))throw Error('denied');});
 const input={...body,clientId};const p=await s.service.preview(input,customer);await s.service.commit({...input,previewHash:p.previewHash},customer);
 expect(s.db.clientRequest.create.mock.calls[0][0].data).toMatchObject({clientId,warehouseId:'w'});
});
it('preserves explicit branch through preview and rejects a changed branch at commit',async()=>{
 const s=setup();const customer={...user,roleCodes:['CLIENT'],activeWarehouseId:null};
 s.db.warehouseClient.findMany.mockResolvedValue([{warehouseId:'w',warehouse:{name:'Moscow'}},{warehouseId:'w2',warehouse:{name:'Other'}}]);
 const input={...body,warehouseId:'w2'};const p=await s.service.preview(input,customer);await s.service.commit({...input,previewHash:p.previewHash},customer);
 expect(s.db.clientRequest.create.mock.calls[0][0].data.warehouseId).toBe('w2');
 await expect(s.service.commit({...input,warehouseId:'w',previewHash:p.previewHash},customer)).rejects.toThrow('изменился');
});
it('requires branch selection when ambiguous and refuses unrelated branch or account',async()=>{
 const s=setup(),customer={...user,roleCodes:['CLIENT'],activeWarehouseId:null};
 s.db.warehouseClient.findMany.mockResolvedValue([{warehouseId:'w',warehouse:{name:'A'}},{warehouseId:'w2',warehouse:{name:'B'}}]);
 await expect(s.service.preview(body,customer)).rejects.toThrow('Выберите филиал');
 await expect(s.service.preview({...body,warehouseId:'foreign'},customer)).rejects.toThrow('недоступен');
 s.db.clientMarketplaceConnection.findFirst.mockResolvedValue(null);
 await expect(s.service.preview({...body,warehouseId:'w'},customer)).rejects.toThrow('Кабинет Ozon');
 expect(s.db.$transaction).not.toHaveBeenCalled();
});

// TEST: use real authorization for two managed clients; unrelated/read-only access is denied.
it('lists only the requested managed client accounts without needing an active internal branch',async()=>{
 const s=setup(),scope=new ClientScopeService();
 const customer={...user,roleCodes:['CLIENT'],permissionCodes:[],activeWarehouseId:null,clientScopeMode:'LIMITED',clientIds:['c','second','readonly'],writableClientIds:['c','second']} as any;
 s.db.clientMarketplaceConnection.findMany=vi.fn(async({where}:any)=>[{id:where.clientId+'-account'}]);
 const service=new OzonLinkImportService(s.db,scope,new OzonFboImportService(s.db,scope),s.supply as any);
 for(const clientId of ['c','second']){
  expect(await service.connections(clientId,customer)).toEqual([{id:clientId+'-account'}]);
  expect(s.db.clientMarketplaceConnection.findMany).toHaveBeenLastCalledWith(expect.objectContaining({where:{clientId,marketplace:'OZON',isActive:true}}));
 }
 for(const clientId of ['other','readonly'])await expect(service.connections(clientId,customer)).rejects.toThrow('Нет доступа');
 expect(s.db.clientMarketplaceConnection.findMany).toHaveBeenCalledTimes(2);
});
it('does not bypass internal branch scope',async()=>{
 const s=setup();await expect(s.service.preview(body,{...user,permissionCodes:[],roleCodes:['BRANCH_MANAGER'],activeWarehouseId:null,warehouseIds:['w'],writableWarehouseIds:['w']})).rejects.toThrow('Активный филиал');
 expect(s.supply.snapshot).not.toHaveBeenCalled();
});

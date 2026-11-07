import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { YandexFbyService } from '../src/modules/yandex-fby/yandex-fby.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import * as XLSX from 'xlsx';
const user:any={id:'u',permissionCodes:['client-requests:read','client-requests:write'],roleCodes:['CLIENT'],clientIds:['c'],writableClientIds:['c']};
let db:any,service:YandexFbyService,remote:any;
const input={warehouseId:'w',items:[{barcode:'001',quantity:2}],destination:'Москва'};
beforeEach(()=>{
 vi.stubEnv('WMS_YANDEX_FBY_ENABLED','true');
 db={clientMarketplaceConnection:{findFirst:vi.fn(async()=>({id:'a',clientId:'c',sellerId:'1',apiKey:'secret'}))},warehouseClient:{findMany:vi.fn(async()=>[{warehouse:{id:'w',name:'Москва'}}])},barcode:{findMany:vi.fn(async()=>[{value:'001',skuId:'s',sku:{id:'s',name:'Товар',size:'S'}}])},yandexFbyShipment:{findFirst:vi.fn(async()=>null),update:vi.fn()},clientRequest:{create:vi.fn(async({data}:any)=>({id:'r',...data})),findFirst:vi.fn()},$executeRaw:vi.fn(),$transaction:vi.fn(async(fn:any)=>fn(db))};
 service=new YandexFbyService(db,new ClientScopeService(),{previewAvailability:vi.fn(async()=>({canCommit:true,lines:[]}))} as any);
 remote={supply:vi.fn(async()=>({id:{id:42,marketplaceRequestId:'100'},type:'SUPPLY',subtype:'DEFAULT',status:'CREATED',targetLocation:{name:'Москва'}})),items:vi.fn(async()=>[{offerId:'offer',name:'Товар',counters:{planCount:2}}])};(service as any).remote=remote;
});
afterEach(()=>vi.unstubAllEnvs());
// TEST: no write calls, scoped reads and a second coherent snapshot after catalogue loading.
it('exports actual units and revalidates packaging after the remote read',async()=>{
 const r={number:7,status:'PACKED',items:[{id:'i',skuId:'s',quantity:1}],yandexFbyShipment:{snapshot:{lines:[]}},fboAssembly:{phase:'COMPLETED',units:[{id:'u',requestItemId:'i',skuId:'s',barcode:'001',state:'PACKED',targetBoxId:'b'}],boxes:[{boxId:'b',closedAt:new Date(),confirmedAt:new Date()}]}};
 db.clientRequest.findFirst.mockResolvedValue(r);remote.offers=vi.fn(async()=>[{offerId:'seller',name:'Name',barcodes:['001']}]);
 const file=await service.exportActual('a','r',user);expect(file.number).toBe(7);expect(file.buffer.length).toBeGreaterThan(1000);
 expect(db.clientRequest.findFirst).toHaveBeenCalledTimes(2);expect(db.clientRequest.findFirst.mock.calls[0][0].where).toMatchObject({id:'r',clientId:'c',yandexFbyShipment:{is:{connectionId:'a'}}});
 expect(db.clientRequest.create).not.toHaveBeenCalled();expect(db.yandexFbyShipment.update).not.toHaveBeenCalled();expect(db.$executeRaw).not.toHaveBeenCalled();
 remote.offers.mockImplementation(async()=>{r.fboAssembly.phase='PACKING';return [{offerId:'seller',name:'Name',barcodes:['001']}];});
 await expect(service.exportActual('a','r',user)).rejects.toThrow('Завершите');
});
it('denies unavailable requests and foreign clients before reading the catalogue',async()=>{
 remote.offers=vi.fn();db.clientRequest.findFirst.mockResolvedValue(null);
 await expect(service.exportActual('a','missing',user)).rejects.toThrow('недоступна');
 await expect(service.exportActual('a','r',{...user,clientIds:[]})).rejects.toThrow();expect(remote.offers).not.toHaveBeenCalled();
});
// TEST: read disabled cabinets locally while retaining the active-only mutation guard.
it('keeps disabled cabinet history readable without enabling imports',async()=>{
 vi.stubEnv('WMS_MARKETPLACE_WORKSPACES_ENABLED','true');
 db.clientRequest.findMany=vi.fn(async()=>[]);
 await service.list('a',user,'active');
 expect(db.clientMarketplaceConnection.findFirst.mock.calls.at(-1)[0].where.isActive).toBeUndefined();
 await service.preview('a',input,user);
 expect(db.clientMarketplaceConnection.findFirst.mock.calls.at(-1)[0].where.isActive).toBe(true);
});
// TEST: binding and import share the supply lock; no generic database error or duplicate binding.
it('rejects an already bound supply under the same lock as import',async()=>{
 const dto={warehouseId:'w',reference:'100',mappings:[{offerId:'offer',barcode:'001'}]};
 const p=await service.preview('a',dto,user);
 db.clientRequest.findFirst.mockResolvedValue({id:'r',warehouseId:'w',items:[{skuId:'s',quantity:2}]});
 db.yandexFbyShipment.findFirst.mockResolvedValue({requestId:'another'});
 await expect(service.bind('a','r',{...dto,previewHash:p.previewHash},user)).rejects.toThrow('уже привязана');
 expect(db.$executeRaw.mock.calls[0][1]).toBe('yandex:a:42');
 expect(db.yandexFbyShipment.update).not.toHaveBeenCalled();
});
// TEST: fail closed for permissions, warehouse, mismatched composition and repeated writes.
it('denies disabled installations and foreign clients before remote or write calls',async()=>{
 vi.stubEnv('WMS_YANDEX_FBY_ENABLED','false');await expect(service.preview('a',input,user)).rejects.toThrow();
 vi.stubEnv('WMS_YANDEX_FBY_ENABLED','true');await expect(service.preview('a',input,{...user,writableClientIds:[]})).rejects.toThrow();expect(remote.supply).not.toHaveBeenCalled();expect(db.clientRequest.create).not.toHaveBeenCalled();
});
it('rejects a foreign warehouse and ambiguous barcode',async()=>{
 await expect(service.preview('a',{...input,warehouseId:'foreign'},user)).rejects.toThrow('Филиал');
 db.barcode.findMany.mockResolvedValue([{value:'001',skuId:'s',sku:{id:'s'}},{value:'001',skuId:'other',sku:{id:'other'}}]);
 expect((await service.preview('a',input,user)).canCreate).toBe(false);
});
it('requires explicit barcode mapping for remote offer IDs',async()=>{
 const p=await service.preview('a',{warehouseId:'w',reference:'100'},user);expect(p.canCreate).toBe(false);expect(p.lines[0].offerId).toBe('offer');
 const mapped=await service.preview('a',{warehouseId:'w',reference:'100',mappings:[{offerId:'offer',barcode:'001'}]},user);expect(mapped.canCreate).toBe(true);
});
it('creates a manual assembly with persisted Yandex identity in the same transaction',async()=>{
 const p=await service.preview('a',input,user);await service.create('a',{...input,idempotencyKey:'key',previewHash:p.previewHash},user);
 expect(db.clientRequest.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({type:'OUTBOUND',clientId:'c',yandexFbyShipment:{create:expect.objectContaining({connectionId:'a',importKey:'yandex:a:manual:key'})}})}));
});
it('rejects changed demand between preview and create',async()=>{
 const p=await service.preview('a',input,user);await expect(service.create('a',{...input,items:[{barcode:'001',quantity:3}],idempotencyKey:'key',previewHash:p.previewHash},user)).rejects.toThrow('Состав изменился');expect(db.clientRequest.create).not.toHaveBeenCalled();
});
it('returns an existing assembly after a repeated import without another create',async()=>{
 db.yandexFbyShipment.findFirst.mockResolvedValue({request:{id:'existing',warehouseId:'w'}});
 const result=await service.create('a',{warehouseId:'w',reference:'100',idempotencyKey:'key',previewHash:'old'},user);expect(result.existing).toBe(true);expect(db.clientRequest.create).not.toHaveBeenCalled();
});
it('refresh persists remote status without mutating assembly, picked units or bindings',async()=>{
 db.yandexFbyShipment.updateMany=vi.fn(async()=>({count:1}));
 db.yandexFbyShipment.findFirst.mockResolvedValue({remoteNumber:'100',remoteId:'42',request:{warehouseId:'w',items:[]},snapshot:{lines:[{offerId:'offer',quantity:3}]}});
 const result=await service.refresh('a','r',user);expect(result.matches).toBe(false);expect(result.differences).toEqual([{offerId:'offer',assemblyQuantity:3,yandexQuantity:2}]);expect(db.yandexFbyShipment.update).not.toHaveBeenCalled();expect(db.clientRequest.create).not.toHaveBeenCalled();
 expect(db.yandexFbyShipment.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({requestId:'r',connectionId:'a',remoteId:'42'}),data:{remoteStatus:'CREATED',checkedAt:expect.any(Date)}}));
});
// TEST: stale responses and failed remote reads cannot replace the last successful check.
it('rejects a refresh superseded by another refresh or a changed binding',async()=>{
 db.yandexFbyShipment.findFirst.mockResolvedValue({remoteNumber:'100',remoteId:'42',request:{warehouseId:'w'},snapshot:{lines:[]}});
 db.yandexFbyShipment.updateMany=vi.fn(async()=>({count:0}));
 await expect(service.refresh('a','r',user)).rejects.toThrow('Повторите');
});
it('does not persist a partial remote check or a demo check',async()=>{
 db.yandexFbyShipment.findFirst.mockResolvedValue({remoteNumber:'100',remoteId:'42',request:{warehouseId:'w'},snapshot:{lines:[]}});
 db.yandexFbyShipment.updateMany=vi.fn();
 remote.items.mockRejectedValueOnce(new Error('remote unavailable'));
 await expect(service.refresh('a','r',user)).rejects.toThrow('remote unavailable');
 await service.refresh('a','r',{...user,isDemo:true});
 expect(db.yandexFbyShipment.updateMany).not.toHaveBeenCalled();
});
it('parses the Excel template and keeps leading zeros; rejects wrong columns',async()=>{
 const make=(rows:unknown[][])=>{const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet(rows),'FBY');return XLSX.write(b,{type:'buffer',bookType:'xlsx'})};
 expect(await service.parse('a',make([['ШК','Количество'],['001',2]]),user)).toEqual([{barcode:'001',quantity:2}]);
 await expect(service.parse('a',make([['Товар','Цена'],['001',2]]),user)).rejects.toThrow('Первые колонки');
});
it('does not bind a different remote composition to a prepared assembly',async()=>{
 db.clientRequest.findFirst.mockResolvedValue({id:'r',clientId:'c',warehouseId:'w',items:[{skuId:'s',quantity:3}]});
 const dto={warehouseId:'w',reference:'100',mappings:[{offerId:'offer',barcode:'001'}]};const p=await service.preview('a',dto,user);
 await expect(service.bind('a','r',{...dto,previewHash:p.previewHash},user)).rejects.toThrow('не совпадает');expect(db.yandexFbyShipment.update).not.toHaveBeenCalled();
});
it('folds barcode aliases into one warehouse demand line',async()=>{
 db.barcode.findMany.mockResolvedValue([{value:'001',skuId:'s',sku:{id:'s',name:'Товар'}},{value:'002',skuId:'s',sku:{id:'s',name:'Товар'}}]);
 const p=await service.preview('a',{...input,items:[{barcode:'001',quantity:2},{barcode:'002',quantity:3}]},user);
 expect(p.items).toEqual([{skuId:'s',name:'Товар',barcode:'001',quantity:5}]);
});

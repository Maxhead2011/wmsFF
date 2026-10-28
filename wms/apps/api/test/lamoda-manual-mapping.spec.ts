import {expect,it,vi,afterEach} from 'vitest';
import {LamodaService} from '../src/modules/lamoda/lamoda.service';
import {ClientScopeService} from '../src/modules/auth/client-scope.service';
import {resolveLamodaLines,useLamodaWarehouseBarcodes} from '../src/modules/lamoda/lamoda-fbo-policy';
vi.mock('../src/common/stock/wb-order-stock-lifecycle', () => ({ wbReservationQuantities: vi.fn(async () => new Map()) }));
const user:any={id:'u',roleCodes:['CLIENT'],permissionCodes:['client-requests:read','client-requests:write'],clientScopeMode:'LIMITED',clientIds:['c'],writableClientIds:['c']};
afterEach(()=>vi.unstubAllEnvs());
// TEST: a customer explicitly links different marketplace and warehouse identities.
it('links only an own non-draft SKU even with different barcode and article',async()=>{
 vi.stubEnv('WMS_LAMODA_ENABLED','true');
 const product={id:'p',barcode:'11111111',externalSku:'LAMODA-A',size:'50',skuId:null,isPresent:true};
 const db:any={lamodaAccount:{findUnique:vi.fn(async()=>({id:'a',clientId:'c'}))},lamodaProduct:{findFirst:vi.fn(async()=>product),update:vi.fn(async()=>({}))},sku:{findFirst:vi.fn(async()=>({id:'s',barcodes:[{value:'22222222'}]})),findMany:vi.fn(async()=>[])},auditLog:{create:vi.fn()}};db.$transaction=async(fn:any)=>fn(db);
 const service=new LamodaService(db,new ClientScopeService(),{} as any);
 await service.link('a','p','s',user);
 expect(db.sku.findFirst.mock.calls[0][0].where).toEqual({id:'s',clientId:'c',isDraft:false});
 expect(db.auditLog.create).toHaveBeenCalled();
 db.sku.findFirst.mockResolvedValue(null);await expect(service.link('a','p','foreign',user)).rejects.toThrow();
 await expect(service.link('a','p','s',{...user,writableClientIds:[]})).rejects.toThrow();
 await expect(service.link('a','p','s',{...user,permissionCodes:['client-requests:read']})).rejects.toThrow();
 await expect(service.link('a','p','s',{...user,clientIds:['other'],writableClientIds:['other']})).rejects.toThrow();
 await expect(service.update('a',{secret:'no'},user)).rejects.toThrow();
});
// TEST: Lamoda imports resolve by external identity, but TSD receives warehouse codes.
it('preserves the Lamoda plan and converts reservation and direction barcodes',()=>{
 const lines=[{barcode:'11111111',article:'LM-A',quantity:2,destination:'Moscow'}];
 const resolved=resolveLamodaLines(lines,[{remoteSku:'LM1',barcode:'11111111',externalSku:'LM-A',skuId:'s',isPresent:true,linkState:'CONFIRMED'}]);
 const result=useLamodaWarehouseBarcodes(resolved,[{id:'s',barcodes:[{value:'33333333'},{value:'22222222',isPrimary:true}]}]);
 expect(result.items).toEqual([{skuId:'s',barcode:'22222222',quantity:2}]);expect(result.directions[0].items).toEqual(result.items);
 expect(lines[0].barcode).toBe('11111111');expect(resolved.items[0].barcode).toBe('11111111');
 expect(()=>useLamodaWarehouseBarcodes(resolved,[])).toThrow();
});
// TEST: search broadens identity matching, never client scope; preview uses the saved link.
it('searches own warehouse identifiers and previews the mapped warehouse barcode',async()=>{
 vi.stubEnv('WMS_LAMODA_ENABLED','true');vi.stubEnv('WMS_LAMODA_FBO_ASSEMBLY_ENABLED','true');
 const sku={id:'s',barcodes:[{value:'22222222',isPrimary:true}]};
 const product={barcode:'11111111',externalSku:'LM-A',skuId:'s',remoteSku:'LM1',isPresent:true,linkState:'CONFIRMED'};
 const db:any={lamodaAccount:{findUnique:async()=>({clientId:'c'})},lamodaProduct:{findFirst:async()=>product,findMany:async()=>[product]},sku:{findMany:vi.fn(async()=>[sku])},lamodaPlan:{findFirst:async()=>({warehouseId:'w',items:[{barcode:'11111111',article:'LM-A',quantity:2}]})}};
 const requests={previewAvailability:vi.fn(async()=>({lines:[]}))};const service=new LamodaService(db,new ClientScopeService(),requests as any);
 db.$transaction=async(fn:any)=>fn(db);db.client={findUniqueOrThrow:async()=>({storesWithoutBoxes:true})};
 db.stockBalance={findMany:async()=>[{skuId:'s',boxId:null,quantity:2}]};db.lamodaFboAssembly={findUnique:async()=>null};
 await service.candidates('a','p',user,'WMS-A');
 expect(db.sku.findMany.mock.calls[0][0].where).toMatchObject({clientId:'c',isDraft:false,OR:[{internalSku:{contains:'WMS-A',mode:'insensitive'}},{name:{contains:'WMS-A',mode:'insensitive'}},{barcodes:{some:{value:{contains:'WMS-A'}}}}]});
 const preview=await service.availability('a','plan',user);
 expect(preview.availability.lines).toEqual([expect.objectContaining({skuId:'s',barcode:'22222222',requestedQuantity:2,availableQuantity:2})]);
});

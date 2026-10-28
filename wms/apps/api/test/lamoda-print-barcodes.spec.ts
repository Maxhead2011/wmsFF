import { afterEach, expect, it, vi } from 'vitest';
import { SkusService } from '../src/modules/skus/skus.service';
import { SkusController } from '../src/modules/skus/skus.controller';
import { isLamodaPrintBarcode, withLamodaPrintBarcodes } from '../src/modules/print/lamoda-print-barcodes';
const sku = { id:'s', clientId:'c', name:'Костюм', marketplacePayload:null, barcodes:[{id:'b',value:'2000000000011',isPrimary:true}] };
function setup() {
 const db:any={sku:{findMany:vi.fn(async()=>[structuredClone(sku)])},lamodaProduct:{findMany:vi.fn(async()=>[
  {id:'lm',skuId:'s',barcode:'04640684262439',account:{clientId:'c'}}
 ])}};
 const scopes:any={resolveClientFilter:vi.fn(()=> 'c')};
 return {db,service:new SkusService(db,scopes,{} as any)};
}
afterEach(()=>vi.unstubAllEnvs());
// TEST: a mapped Lamoda barcode must be searchable and selectable only in printing.
it('adds a labeled Lamoda barcode without replacing the warehouse primary',async()=>{
 vi.stubEnv('WMS_LAMODA_ENABLED','true');const {db,service}=setup();
 const rows=await service.list({clientId:'c',search:'04640684262439',forPrint:true} as any,{} as any);
 expect(rows[0].barcodes).toEqual([sku.barcodes[0],{id:'lamoda:lm',value:'04640684262439',isPrimary:false,source:'LAMODA'}]);
 expect(db.sku.findMany.mock.calls[0][0].where).toMatchObject({clientId:'c',OR:expect.arrayContaining([
  {lamodaProducts:{some:expect.objectContaining({isPresent:true,linkState:'CONFIRMED',account:{isActive:true,clientId:'c'}})}}
 ])});
 expect(db.lamodaProduct.findMany.mock.calls[0][0].where).toMatchObject({isPresent:true,linkState:'CONFIRMED',account:{isActive:true}});
 expect(sku.barcodes).toHaveLength(1);
});
it.each([false,true])('keeps ordinary SKU lookup unchanged when printing=%s and Lamoda is off',async(forPrint)=>{
 vi.stubEnv('WMS_LAMODA_ENABLED','false');const {db,service}=setup();
 expect((await service.list({forPrint} as any,{} as any))[0].barcodes).toEqual(sku.barcodes);
 expect(db.lamodaProduct.findMany).not.toHaveBeenCalled();
});
it('does not expose marketplace aliases to inventory callers',async()=>{
 vi.stubEnv('WMS_LAMODA_ENABLED','true');const {db,service}=setup();
 expect((await service.list({},{} as any))[0].barcodes).toEqual(sku.barcodes);
 expect(db.lamodaProduct.findMany).not.toHaveBeenCalled();
});
// TEST: print controller opt-in is exact, and does not change ordinary SKU consumers.
it('passes an explicit print flag through the existing scoped controller',()=>{
 const service:any={list:vi.fn()};const controller=new SkusController(service);const user={} as any;
 controller.list(user,'c','LM','false','true');
 expect(service.list).toHaveBeenCalledWith({clientId:'c',search:'LM',draftsOnly:false,forPrint:true},user);
 controller.list(user,'c','LM','false','1');
 expect(service.list).toHaveBeenLastCalledWith({clientId:'c',search:'LM',draftsOnly:false,forPrint:false},user);
});
it('does not attach foreign, empty or duplicate aliases',async()=>{
 vi.stubEnv('WMS_LAMODA_ENABLED','true');const {db}=setup();
 db.lamodaProduct.findMany.mockResolvedValue([
  {id:'foreign',skuId:'s',barcode:'999',account:{clientId:'other'}},
  {id:'missing',skuId:'s',barcode:'',account:{clientId:'c'}},
  {id:'same',skuId:'s',barcode:sku.barcodes[0].value,account:{clientId:'c'}},
  {id:'lm',skuId:'s',barcode:'04640684262439',account:{clientId:'c'}},
  {id:'lm2',skuId:'s',barcode:'04640684262439',account:{clientId:'c'}},
 ]);
 const result=await withLamodaPrintBarcodes(db,[sku]);
 expect(result[0].barcodes.map(b=>b.value)).toEqual(['2000000000011','04640684262439']);
 expect(result[0].barcodes[0]).toEqual({...sku.barcodes[0],source:'LAMODA'});
 expect(sku.barcodes[0]).not.toHaveProperty('source');
 expect(sku.barcodes).toHaveLength(1);
});
it('revalidates active account, client, exact barcode and confirmed SKU link for printing',async()=>{
 vi.stubEnv('WMS_LAMODA_ENABLED','true');const db:any={lamodaProduct:{findFirst:vi.fn(async()=>({id:'p'}))}};
 expect(await isLamodaPrintBarcode(db,'s','c','04640684262439')).toBe(true);
 expect(db.lamodaProduct.findFirst).toHaveBeenCalledWith({where:{skuId:'s',barcode:'04640684262439',isPresent:true,linkState:'CONFIRMED',account:{isActive:true,clientId:'c'}},select:{id:true}});
 db.lamodaProduct.findFirst.mockResolvedValue(null);
 expect(await isLamodaPrintBarcode(db,'s','c','000')).toBe(false);
 vi.stubEnv('WMS_LAMODA_ENABLED','false');db.lamodaProduct.findFirst.mockClear();
 expect(await isLamodaPrintBarcode(db,'s','c','04640684262439')).toBe(false);
 expect(db.lamodaProduct.findFirst).not.toHaveBeenCalled();
});

import { expect, it, vi } from 'vitest';
import { enableCatalogReconciliation, savedCatalogCards, catalogReconciliationEnabled } from '../src/modules/marketplace-connections/catalog-reconciliation';
function fixture(){let value=false;const db:any={systemSetting:{findUnique:vi.fn(async()=>({value})),upsert:vi.fn(async()=>{value=true;})},auditLog:{create:vi.fn()},$queryRaw:vi.fn(),clientMarketplaceConnection:{count:vi.fn(async()=>1)},sku:{findMany:vi.fn(async()=>[{id:'s',marketplaceProductId:'p',marketplaceOfferId:'o',barcodes:[{value:'001'}]}])}};db.$transaction=async(fn:any)=>fn(db);return db;}
// TEST: persistent catalogue enablement does not change operational allowlists or product links.
it('enables once and writes one audit event',async()=>{const db=fixture();const prior=process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS;
 expect(await enableCatalogReconciliation(db,'c',{id:'u',roleCodes:['ADMIN']})).toEqual({enabled:true,changed:true});
 expect(await catalogReconciliationEnabled(db,'c')).toBe(true);
 expect(await enableCatalogReconciliation(db,'c',{id:'u',roleCodes:['ADMIN']})).toEqual({enabled:true,changed:false});
 expect(db.auditLog.create).toHaveBeenCalledTimes(1);expect(process.env.WMS_MARKETPLACE_PRODUCT_LINK_CLIENTS).toBe(prior);
});
it('rejects nonadministrators without writing',async()=>{const db=fixture();await expect(enableCatalogReconciliation(db,'c',{id:'u',roleCodes:['CLIENT']})).rejects.toThrow();expect(db.systemSetting.upsert).not.toHaveBeenCalled();});
it('keeps legacy cards explicitly unconfirmed',async()=>{const db=fixture();const rows=await savedCatalogCards(db,{id:'conn',clientId:'c',marketplace:'OZON'});expect(rows[0].status).toBe('SAVED_CARD');expect(rows[0].barcodes).toEqual(['001']);expect(db.sku.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({clientId:'c',marketplace:'OZON'})}));});
it('does not attribute legacy cards to an arbitrary account',async()=>{const db=fixture();db.clientMarketplaceConnection.count.mockResolvedValue(2);expect(await savedCatalogCards(db,{id:'conn',clientId:'c',marketplace:'OZON'})).toEqual([]);expect(db.sku.findMany).not.toHaveBeenCalled();});

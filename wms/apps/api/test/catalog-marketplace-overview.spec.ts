import { expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
vi.mock('../src/modules/marketplace-connections/marketplace-product-links',()=>({productLinksEnabled:()=>true,readProductLinks:async()=>[{id:'l',marketplace:'OZON',skuId:'s',productId:'p',offerId:'offer',barcodes:['002'],size:'50',color:'серый',status:'LINKED'}]}));
vi.mock('../src/common/stock/wb-order-stock-lifecycle',()=>({wbReservationQuantities:async()=>new Map()}));
// TEST: actual read handler must expose Ozon barcodes, not replace them with the WMS barcode.
it('keeps marketplace and warehouse barcodes distinct and checks access',async()=>{
 const scopes={requireClientAccess:vi.fn()};
 const prisma={clientMarketplaceConnection:{findUnique:async()=>({id:'c',clientId:'owner'})},sku:{findMany:async()=>[{id:'s',barcodes:[{value:'001'}]}]},stockBalance:{groupBy:async()=>[]}};
 const service=new MarketplaceConnectionsService(prisma as never,scopes as never);
 (service as any).resolveFbsExecutionWarehouseId=async()=>null;
 const result=await service.productLinks('c',{} as never);
 expect(scopes.requireClientAccess).toHaveBeenCalledWith({},'owner','read');
 expect(result.items[0].barcodes).toEqual(['002']);
 expect(result.items[0].sku?.barcodes).toEqual([{value:'001'}]);
 expect(result.items[0].size).toBe('50');
});

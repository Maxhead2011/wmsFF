import { afterEach, it, expect, vi } from 'vitest';
import { MarketplaceConnectionsService } from './marketplace-connections.service';
afterEach(()=>vi.unstubAllEnvs());
// TEST: even a forged old device prefix must not turn post-pick print ACK into a shipment.
it.each([true,false])('post-pick ACK success=%s touches only printing and audit',async success=>{
 vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED','true');
 const job={id:'j',source:'SOS_POST_PICK',deviceCode:'SOS-WB:old',assemblyId:'a',status:'PRINTED',printedAt:new Date()};
 const service:any=Object.create(MarketplaceConnectionsService.prototype);
 service.prisma={fbsPrintJob:{updateMany:vi.fn(),findUniqueOrThrow:vi.fn(async()=>job),update:vi.fn(async()=>job)},auditLog:{create:vi.fn()}};
 expect(await service.finishFbsPrintJob('j',success,null,{id:'u'} as any)).toBe(job);
});
it('post-pick job uses atomic claim and cannot be automatically reclaimed',async()=>{
 const job={id:'j',source:'SOS_POST_PICK',deviceCode:'SOS-POST:device',requestNumber:1,orderId:'123',warehouseName:'Ozon'};
 const service:any=Object.create(MarketplaceConnectionsService.prototype);
 const findFirst=vi.fn(async(_q:any)=>job),updateMany=vi.fn(async(_q:any)=>({count:0}));
 service.prisma={fbsPrintStation:{update:vi.fn()},fbsPrintJob:{findFirst,updateMany}};
 expect(await service.claimFbsPrintJob('s',{} as any)).toBeNull();
 expect(findFirst.mock.calls[0][0].where.OR[1].source.notIn).toContain('SOS_POST_PICK');
 expect(updateMany.mock.calls[0][0].where).toEqual({id:'j',status:'QUEUED'});
});

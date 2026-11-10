import { afterEach, expect, it, vi } from 'vitest';
import { restoreSavedFbsArchive, archiveRange } from './fbs-saved-archive';
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
function setup(){
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
 vi.stubEnv('WMS_FBS_SAVED_ARCHIVE_ENABLED','true');
 const connection={id:'cab',marketplace:'WILDBERRIES',accountName:'WB'};
 const link={clientId:'c',connectionId:'cab',marketplace:'WILDBERRIES',orderId:'1',syncStatus:'ACTIVE',lastCategory:'shipped',lastSupplierStatus:'complete',lastWbStatus:'sorted',lastSkuId:null,lastItemCount:2,handedOverAt:new Date('2026-11-09T10:00:00Z'),lastSeenAt:new Date(),request:{id:'r',status:'DONE',warehouseId:'wh'}};
 const db={clientMarketplaceConnection:{findMany:vi.fn(async()=>[connection])},fbsOrderRequestLink:{findMany:vi.fn(async()=>[link])},sku:{findMany:vi.fn(async()=>[])},fbsSupplyPlan:{findMany:vi.fn(async()=>[])}};
 const response={client:{id:'c'},connections:[connection],orders:[],counts:{all:0}};
 return {db,link,response};
}
// TEST: no warm cache, completed request and missing SKU must not erase shipment history.
it('restores the archive after every cold start without writes',async()=>{const x=setup();for(let i=0;i<2;i++){const r=await restoreSavedFbsArchive(x.db,'c',x.response);expect(r.counts.shipped).toBe(1);expect(r.orders[0]).toMatchObject({itemCount:2,request:{status:'DONE'},sourceTiming:{handedOverAt:'2026-11-09T10:00:00.000Z'}})}expect(x.db.fbsOrderRequestLink.findMany.mock.calls[0][0].where).not.toHaveProperty('request');});
it('does not duplicate or overwrite a current marketplace cancellation',async()=>{const x=setup();(x.response.orders as any[]).push({id:'1',connectionId:'cab',marketplace:'WILDBERRIES',category:'cancelled'});const r=await restoreSavedFbsArchive(x.db,'c',x.response);expect(r.orders).toHaveLength(1);expect(r.counts.cancelled).toBe(1)});
it('preserves sold orders in the received archive',async()=>{const x=setup();x.link.lastCategory='archive';const r=await restoreSavedFbsArchive(x.db,'c',x.response);expect(r.counts.archive).toBe(1)});
it.each(['foreign-client','foreign-cabinet','removed'])('rejects %s rows',async kind=>{const x=setup();if(kind==='foreign-client')x.link.clientId='other';if(kind==='foreign-cabinet')x.link.connectionId='other';if(kind==='removed')x.link.syncStatus='REMOVED';expect((await restoreSavedFbsArchive(x.db,'c',x.response)).orders).toHaveLength(0)});
it('does not read data for a hidden cabinet',async()=>{const x=setup();x.response.connections=[];expect(await restoreSavedFbsArchive(x.db,'c',x.response)).toBe(x.response);expect(x.db.fbsOrderRequestLink.findMany).not.toHaveBeenCalled()});
it('keeps sold deployment unchanged',async()=>{const x=setup();vi.stubEnv('WMS_FBS_SAVED_ARCHIVE_ENABLED','false');expect(await restoreSavedFbsArchive(x.db,'c',x.response)).toBe(x.response);expect(x.db.clientMarketplaceConnection.findMany).not.toHaveBeenCalled()});

// TEST: exact Moscow midnight, leap/calendar validation, SQL range and warm-cache filtering.
it('defaults to three Moscow calendar days',()=>{expect(archiveRange(undefined,undefined,new Date('2026-11-09T22:00:00Z'))).toEqual({from:'2026-11-08',to:'2026-11-10',gte:new Date('2026-11-07T21:00:00Z'),lt:new Date('2026-11-10T21:00:00Z')})});
it.each([['2026-02-30','2026-03-01'],['2026-11-10','2026-11-01'],['oops','2026-11-01']])('rejects invalid range %s/%s',(from,to)=>{expect(()=>archiveRange(from,to)).toThrow()});
it('restricts the database before loading and drops old warm rows',async()=>{const x=setup();(x.response.orders as any[]).push({id:'old',category:'shipped',createdAt:'2026-10-01T10:00:00Z'});const r=await restoreSavedFbsArchive(x.db,'c',x.response);expect(r.orders).toHaveLength(1);expect(x.db.fbsOrderRequestLink.findMany.mock.calls[0][0].where.OR[0]).toEqual({handedOverAt:{gte:new Date('2026-11-07T21:00:00Z'),lt:new Date('2026-11-10T21:00:00Z')}})});
it('uses a saved order date only when shipment time is absent',async()=>{const x=setup();Object.assign(x.link,{handedOverAt:null,orderPlacedAt:new Date('2026-11-09T10:00:00Z')});const r=await restoreSavedFbsArchive(x.db,'c',x.response);expect(r.orders[0].archiveDateBasis).toBe('order');expect(r.orders[0].sourceTiming.handedOverAt).toBeNull()});
it('does not substitute import time for missing historical dates',async()=>{const x=setup();Object.assign(x.link,{handedOverAt:null,orderPlacedAt:null,createdAt:new Date()});expect((await restoreSavedFbsArchive(x.db,'c',x.response)).orders).toHaveLength(0)});
it('honours custom dates and exclusive end boundary',async()=>{const x=setup();x.link.handedOverAt=new Date('2026-11-08T21:00:00Z');expect((await restoreSavedFbsArchive(x.db,'c',x.response,'2026-11-08','2026-11-08')).orders).toHaveLength(0)});

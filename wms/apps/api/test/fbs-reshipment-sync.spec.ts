import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: actual existing synchronization must preserve an explicit reshipment batch.
describe('reshipment synchronization integration', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('does not expand reshipment from unrelated supply orders or erase provenance', async () => {
    vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED','true');
    const request = {id:'new', status:'IN_WORK',title:'Довоз собранного WB',comment:'Исходная заявка 712',fbsOrderLinks:[],items:[]};
    const db = {clientRequest:{findUnique:vi.fn().mockResolvedValue(request),update:vi.fn()},
      fbsRepeatAssemblyRun:{findUnique:vi.fn().mockResolvedValue(null)},
      fbsReshipmentRun:{findUnique:vi.fn().mockResolvedValue({id:'run'}),findMany:vi.fn().mockResolvedValue([])},
      fbsOrderRequestLink:{findUnique:vi.fn().mockRejectedValue(new Error('must not expand'))},
      fbsTsdAssembly:{findMany:vi.fn().mockResolvedValue([])},
      fbsAssemblyAttemptHistory:{findMany:vi.fn().mockResolvedValue([])},
      clientRequestEvent:{create:vi.fn()}, $transaction:vi.fn()};
    db.$transaction.mockImplementation(fn=>fn(db));
    await (new MarketplaceConnectionsService(db as never,{} as never) as any).syncOneFbsRequest('c','new',new Map(),
      [{id:'unrelated',marketplace:'WILDBERRIES',connectionId:'wb'}]);
    expect(db.fbsOrderRequestLink.findUnique).not.toHaveBeenCalled();
    expect(db.clientRequest.update.mock.calls.every(([args])=> !args.data.title || args.data.title===request.title)).toBe(true);
    expect(db.clientRequest.update.mock.calls.every(([args])=> !args.data.comment || args.data.comment===request.comment)).toBe(true);
  });
  it('keeps old SAME_ITEM request quantity after the live task and link move to the delivery request', async () => {
    vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED','true');
    const task = {id:'physical',requestId:'original',requestItemId:'item',orderId:'100',clientId:'c',skuId:'sku',
      barcodes:['4600'],barcode:'4600',productName:'Костюм',itemCount:1,status:'COMPLETED',kiz:'mark',completedAt:'2026-09-01T10:00:00Z'};
    const request = {id:'original',status:'IN_WORK',title:'FBS',comment:'',fbsOrderLinks:[],
      items:[{id:'item',skuId:'sku',name:'Костюм',barcode:'4600',quantity:1,comment:'',packageItems:[],boxSelections:[]}]};
    const db = {clientRequest:{findUnique:vi.fn().mockResolvedValue(request),update:vi.fn()},
      fbsRepeatAssemblyRun:{findUnique:vi.fn().mockResolvedValue(null)},
      fbsReshipmentRun:{findUnique:vi.fn().mockResolvedValue(null),findMany:vi.fn().mockResolvedValue([
        {snapshot:{physicalEvidence:[{task,link:{requestId:'original'}}]}}])},
      fbsTsdAssembly:{findMany:vi.fn().mockResolvedValue([])},
      fbsAssemblyAttemptHistory:{findMany:vi.fn().mockResolvedValue([])},
      clientRequestItem:{update:vi.fn(),delete:vi.fn()}, clientRequestEvent:{create:vi.fn()},$transaction:vi.fn()};
    db.$transaction.mockImplementation(fn=>fn(db));
    await (new MarketplaceConnectionsService(db as never,{} as never) as any).syncOneFbsRequest('c','original',new Map(),[]);
    expect(db.clientRequestItem.delete).not.toHaveBeenCalled();
    expect(db.clientRequestItem.update.mock.calls.every(([args])=>args.data.quantity===1)).toBe(true);
    expect(db.clientRequest.update.mock.calls.every(([args])=>args.data.status!=='CANCELLED')).toBe(true);
    expect(db.fbsReshipmentRun.findMany).toHaveBeenCalled();
  });
});

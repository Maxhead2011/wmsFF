import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TsdAssemblyService } from '../src/modules/tsd/tsd-assembly.service';

function fixture(quantity: number) {
  const db={
    fbsOrderRequestLink:{findMany:vi.fn().mockResolvedValue([{orderId:'5737342163',connectionId:'wb',lastSkuId:'sku',lastItemCount:1}])},
    fbsTsdAssembly:{findMany:vi.fn().mockResolvedValue([])},auditLog:{findMany:vi.fn().mockResolvedValue([])},
    sku:{findMany:vi.fn().mockResolvedValue([{id:'sku'}])},storagePalletBox:{findMany:vi.fn().mockResolvedValue([])},
    stockBalance:{findMany:vi.fn().mockResolvedValue(quantity>0?[{skuId:'sku',quantity,box:{code:'FFL_LKB2107_6'}}]:[])},
  };
  const service:any=new TsdAssemblyService(db as never,{} as never,{} as never,{} as never,{} as never);
  const rows:any=[{itemId:'item',skuId:'sku',name:'Suit',barcode:'2051754386153',requestedQuantity:1,allocations:[{balanceId:'snapshot:old',boxId:'box',boxCode:'FFL_LKB2107_6',quantity:1}]}];
  return {db,service,rows};
}
describe('FBS current location hints',()=>{
  afterEach(()=>vi.unstubAllEnvs());
  // TEST: request 1022 has no target-barcode stock but has a reserved relabel source.
  it.each([true,false])('uses the live relabel source only when enabled: %s',async(enabled)=>{
    vi.stubEnv('WMS_FBS_ONLINE_RELABEL_LOCATIONS_ENABLED',String(enabled));
    const {service,rows,db}=fixture(0);rows[0].allocations=[];
    db.fbsTsdAssembly.findMany.mockResolvedValue([{
      id:'task',orderId:'5737342163',connectionId:'wb',requestItemId:'item',skuId:'sku',
      sourceSkuId:'source',reservedBoxCode:'FFL_LKBS1009_24',status:'RESERVED',itemCount:1,
      deviceCode:'AUTO',updatedAt:new Date(),boxCode:null,barcode:null,kiz:null,
    }] as never);
    db.stockBalance.findMany.mockResolvedValue([{skuId:'source',quantity:9,box:{code:'FFL_LKBS1009_24'}}]);
    const result=await service.loadFbsAssemblyFacts('request-1022',rows);
    expect(result.notCollected.rows[0].availableBoxes).toEqual(enabled
      ?[expect.objectContaining({boxCode:'FFL_LKBS1009_24',quantity:1})]:[]);
  });
  // TEST: two orders share one source box; depletion and cancellation must not invent stock.
  it.each([[9,'RESERVED',2],[1,'RESERVED',1],[0,'RESERVED',0],[9,'RETURN_REQUIRED',0]])(
    'groups source hints at stock %s and status %s',async(quantity,status,expected)=>{
      vi.stubEnv('WMS_FBS_ONLINE_RELABEL_LOCATIONS_ENABLED','true');
      const {service,rows,db}=fixture(0);rows[0].allocations=[];rows[0].requestedQuantity=2;
      const tasks=['5737342163','5737342164'].map((orderId,i)=>({id:`task-${i}`,orderId,connectionId:'wb',
        requestItemId:'item',skuId:'sku',sourceSkuId:'source',reservedBoxCode:'FFL_LKBS1009_24',
        status,itemCount:1,deviceCode:'AUTO',updatedAt:new Date(),boxCode:null,barcode:null,kiz:null}));
      db.fbsTsdAssembly.findMany.mockResolvedValue(tasks as never);
      db.fbsOrderRequestLink.findMany.mockResolvedValue(tasks.map(t=>({orderId:t.orderId,connectionId:'wb',lastSkuId:'sku',lastItemCount:1})));
      db.stockBalance.findMany.mockResolvedValue(quantity?[{skuId:'source',quantity,box:{code:'FFL_LKBS1009_24'}}]:[]);
      const result=await service.loadFbsAssemblyFacts('request-1022',rows);
      const hints=result.notCollected.rows.flatMap((r:any)=>r.availableBoxes);
      expect(hints).toEqual(expected?[expect.objectContaining({boxCode:'FFL_LKBS1009_24',quantity:expected})]:[]);
    });
  // TEST: request 849 has an old allocation, but the actual available balance is empty.
  it('removes an exhausted box while keeping the pending order and demand',async()=>{
    const {service,rows}=fixture(0);
    const result=await service.loadFbsAssemblyFacts('request-849',rows);
    expect(result.notCollected.rows[0]).toMatchObject({remainingQuantity:1,orderIds:['5737342163'],availableBoxes:[]});
  });
  // TEST: real stock keeps its allocation; scope excludes other clients, branches and PACKING.
  it('keeps a real allocation and queries only active available stock in the request scope',async()=>{
    const {service,rows,db}=fixture(5);
    const result=await service.loadFbsAssemblyFacts('request-849',rows);
    expect(result.notCollected.rows[0].availableBoxes).toEqual([expect.objectContaining({boxCode:'FFL_LKB2107_6',quantity:1})]);
    expect(db.stockBalance.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({status:'AVAILABLE',quantity:{gt:0},sku:{client:{requests:{some:{id:'request-849'}}}},warehouse:{requests:{some:{id:'request-849'}}}})}));
  });
  // TEST: partial depletion cannot be replaced by the old snapshot quantity.
  it('caps the hint at the current quantity',async()=>{
    const {service,rows}=fixture(1);rows[0].requestedQuantity=3;rows[0].allocations[0].quantity=3;
    const result=await service.loadFbsAssemblyFacts('request-849',rows);
    expect(result.notCollected.rows[0].availableBoxes[0].quantity).toBe(1);
  });
});

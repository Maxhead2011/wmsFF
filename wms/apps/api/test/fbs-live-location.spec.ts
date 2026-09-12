import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
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

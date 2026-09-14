import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TsdAssemblyService } from '../src/modules/tsd/tsd-assembly.service';

function fixture() {
  const placement={palletId:'pallet',pallet:{code:'PALET_SORT_1001',zoneId:'zone',zone:{code:'Z1',name:'Первое помещение'}}};
  const db:any={
    clientRequest:{findUnique:vi.fn().mockResolvedValue({clientId:'client',warehouseId:'warehouse',status:'IN_WORK'})},
    fbsOrderRequestLink:{findMany:vi.fn().mockResolvedValue([{orderId:'5737342163',connectionId:'wb',lastSkuId:'sku',lastItemCount:1}])},
    fbsTsdAssembly:{findMany:vi.fn().mockResolvedValue([{id:'task',orderId:'5737342163',connectionId:'wb',requestItemId:'item',skuId:'sku',itemCount:1,status:'RESERVED',deviceCode:'AUTO',updatedAt:new Date()}])},
    auditLog:{findMany:vi.fn().mockResolvedValue([])},sku:{findMany:vi.fn().mockResolvedValue([{id:'sku'}])},
    storagePalletBox:{findMany:vi.fn().mockResolvedValue([])},
    stockBalance:{findMany:vi.fn().mockResolvedValue([{id:'balance',skuId:'sku',boxId:'new-box',quantity:4,box:{code:'FFL_LKBBOX_0141',storagePlacement:placement}}])},
  };
  const gateway={repeatAssemblyStockReservations:vi.fn().mockResolvedValue(new Map([['sku',[]]]))};
  const service:any=new TsdAssemblyService(db,{} as never,{} as never,{} as never,{} as never,gateway as never);
  const rows:any=[{itemId:'item',skuId:'sku',name:'Suit',barcode:'2051754386153',requestedQuantity:1,allocations:[]}];
  return {db,gateway,service,rows};
}
describe('online FBS current stock after a shortage or move',()=>{
  beforeEach(()=>vi.stubEnv('WMS_FBS_LIVE_ONLINE_STOCK_ENABLED','true'));
  afterEach(()=>vi.unstubAllEnvs());
  // TEST: request 872's instruction has no allocation, while the unit exists in a newly sorted box.
  it('shows a current box even when the original instruction had no stock',async()=>{
    const {service,rows,db}=fixture();const result=await service.loadFbsAssemblyFacts('request',rows);
    expect(result.notCollected.rows[0].availableBoxes).toEqual([expect.objectContaining({boxCode:'FFL_LKBBOX_0141',quantity:1,palletCode:'PALET_SORT_1001'})]);
    expect(rows[0].allocations).toEqual([]);
    expect(db.stockBalance.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({clientId:'client',warehouseId:'warehouse',status:'AVAILABLE',quantity:{gt:0},box:expect.objectContaining({status:{notIn:['deleted','archived']}})})}));
  });
  // TEST: another live order's reservation must not be advertised as free stock.
  it('subtracts other tasks reservations but credits this order its own reservation',async()=>{
    const {service,rows,gateway}=fixture();gateway.repeatAssemblyStockReservations.mockResolvedValue(new Map([['sku',[{taskId:'task',boxId:'new-box',itemCount:1},{taskId:'other',boxId:'new-box',itemCount:3}]]]) as never);
    expect((await service.loadFbsAssemblyFacts('request',rows)).notCollected.rows[0].availableBoxes[0].quantity).toBe(1);
    gateway.repeatAssemblyStockReservations.mockResolvedValue(new Map([['sku',[{taskId:'other',boxId:'new-box',itemCount:4}]]]) as never);
    expect((await service.loadFbsAssemblyFacts('request',rows)).notCollected.rows[0].availableBoxes).toEqual([]);
  });
  // TEST: an old box must disappear and its replacement must be discovered independently.
  it('replaces exhausted historical allocations with the current placement',async()=>{
    const {service,rows}=fixture();rows[0].allocations=[{boxCode:'OLD',quantity:1}];
    expect((await service.loadFbsAssemblyFacts('request',rows)).notCollected.rows[0].availableBoxes.map((b:any)=>b.boxCode)).toEqual(['FFL_LKBBOX_0141']);
  });
  // TEST: units without a pallet are warehouse stock but not a route for pallet-sort picking.
  it('does not offer unplaced boxes',async()=>{
    const {service,rows,db}=fixture();db.stockBalance.findMany.mockResolvedValue([{skuId:'sku',boxId:'new-box',quantity:4,box:{code:'NEW',storagePlacement:null}}]);
    expect((await service.loadFbsAssemblyFacts('request',rows)).notCollected.rows[0].availableBoxes).toEqual([]);
  });
  // TEST: two pending lines compete for the one unit left after an external reservation.
  it('does not allocate an externally reserved unit to a second request line',async()=>{
    const {service,gateway}=fixture();gateway.repeatAssemblyStockReservations.mockResolvedValue(new Map([['sku',[{taskId:'other',boxId:'new-box',itemCount:3}]]]) as never);
    const hints=await service.loadLiveFbsAvailableBoxes('request',[
      {requestItemId:'first',skuId:'sku',remainingQuantity:1,orders:[{assemblyId:'first-task'}]},
      {requestItemId:'second',skuId:'sku',remainingQuantity:1,orders:[{assemblyId:'second-task'}]},
    ]);
    expect(hints.get('first')[0].quantity).toBe(1);expect(hints.get('second')).toEqual([]);
  });
  // TEST: zero stock and closed requests cannot be repaired by advertising a historical box.
  it('keeps exhausted and closed requests empty',async()=>{
    const {service,rows,db}=fixture();db.stockBalance.findMany.mockResolvedValue([]);
    expect((await service.loadFbsAssemblyFacts('request',rows)).notCollected.rows[0].availableBoxes).toEqual([]);
    db.clientRequest.findUnique.mockResolvedValue({clientId:'client',warehouseId:'warehouse',status:'DONE'});
    expect((await service.loadFbsAssemblyFacts('request',rows)).notCollected.rows[0].availableBoxes).toEqual([]);
  });
  // TEST: new feature is isolated from sold deployments and their original planner.
  it('preserves the original read path when disabled',async()=>{
    vi.stubEnv('WMS_FBS_LIVE_ONLINE_STOCK_ENABLED','false');const {service,rows,gateway}=fixture();
    expect((await service.loadFbsAssemblyFacts('request',rows)).notCollected.rows[0].availableBoxes).toEqual([]);
    expect(gateway.repeatAssemblyStockReservations).not.toHaveBeenCalled();
  });
});

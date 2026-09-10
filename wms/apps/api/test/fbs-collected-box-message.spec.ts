import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => vi.unstubAllEnvs());
// TEST: exercise the scanner entry point; all mutation/claim paths are spies.
function setup() {
  vi.stubEnv('WMS_FBS_COLLECTED_SKU_MESSAGE_ENABLED', 'true');
  const task: any = { id:'current',requestId:'request',clientId:'client',marketplace:'WILDBERRIES',
    status:'IN_PROGRESS',skuId:'next-sku',itemCount:1,productName:'Следующий товар',reservedBoxCode:'FFL_NEXT' };
  const balances = [{skuId:'picked-sku',quantity:7}];
  const items = [{id:'item',skuId:'picked-sku',quantity:2}];
  const tasks: any[] = [1,2].map(n=>({id:'done-'+n,requestItemId:'item',skuId:'picked-sku',sourceSkuId:null,
    status:'COMPLETED',completedAt:new Date(),itemCount:1}));
  const db: any = { storagePallet:{findFirst:vi.fn(async()=>null)},
    box:{findFirst:vi.fn(async()=>({id:'box',code:'FFL_PREVIOUS',warehouseId:'warehouse'}))},
    stockBalance:{aggregate:vi.fn(async()=>({_sum:{quantity:0}})),findMany:vi.fn(async()=>balances)},
    clientRequestItem:{findMany:vi.fn(async()=>items)},fbsTsdAssembly:{findMany:vi.fn(async()=>tasks),updateMany:vi.fn()} };
  const service: any = new MarketplaceConnectionsService(db, {} as never);
  vi.spyOn(service,'loadOwnedFbsTsdAssembly').mockResolvedValue(task);
  vi.spyOn(service,'requireFbsOrderStillCollectable').mockResolvedValue(undefined);
  vi.spyOn(service,'assertFbsTsdLeaseVersion').mockResolvedValue(task);
  vi.spyOn(service,'resolveFbsTsdExpectedWarehouseId').mockResolvedValue('warehouse');
  vi.spyOn(service,'fbsTsdReservationRowsBySku').mockResolvedValue(new Map());
  vi.spyOn(service,'releaseUntouchedFbsReservationsForScannedBox').mockResolvedValue(0);
  vi.spyOn(service,'useRelabelingSourceForCurrentFbsTask').mockResolvedValue(null);
  vi.spyOn(service,'switchFbsTsdAssemblyToBox').mockResolvedValue(null);
  vi.spyOn(service,'getFbsRequestRoute').mockResolvedValue({});
  vi.spyOn(service,'claimFbsTsdBoxAtomically').mockResolvedValue(null);
  vi.spyOn(service,'refreshFbsTsdBoxRoute').mockResolvedValue({state:'SCAN_BOX',message:'Маршрут обновлён'});
  const scan=()=>service.scanFbsTsdBox('current',{boxCode:'FFL_PREVIOUS'},{id:'worker'});
  return {db,service,balances,items,tasks,task,scan};
}
it('explains fulfilled 2/2 demand instead of forcing the next box',async()=>{
  const f=setup();await expect(f.scan()).rejects.toThrow('Нужное количество этого товара уже собрано');
  expect(f.service.claimFbsTsdBoxAtomically).not.toHaveBeenCalled();
  expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
});
it('retains the old response with the rollout flag disabled',async()=>{
  const f=setup();vi.stubEnv('WMS_FBS_COLLECTED_SKU_MESSAGE_ENABLED','false');
  await expect(f.scan()).rejects.toThrow('Маршрут показывает короб');
  expect(f.db.clientRequestItem.findMany).not.toHaveBeenCalled();
});
it.each(['IN_PROGRESS','RESCAN_REQUIRED','RETURN_REQUIRED','CANCELLED','SHIPPED'])(
  'does not count %s as confirmed assembly',async(status)=>{
    const f=setup();f.tasks[1].status=status;await expect(f.scan()).rejects.toThrow('Маршрут показывает короб');
  });
it('requires a completion timestamp',async()=>{
  const f=setup();f.tasks[1].completedAt=null;await expect(f.scan()).rejects.toThrow('Маршрут показывает короб');
});
it('does not announce completion if another unit is required',async()=>{
  const f=setup();f.items[0].quantity=3;await expect(f.scan()).rejects.toThrow('Маршрут показывает короб');
});
it('does not confuse a different size/SKU with a completed one',async()=>{
  const f=setup();f.items[0].skuId='different-size';await expect(f.scan()).rejects.toThrow('Маршрут показывает короб');
});
it('does not mask remaining demand in a mixed box',async()=>{
  const f=setup();f.balances.push({skuId:'still-needed',quantity:1});
  f.items.push({id:'other-item',skuId:'still-needed',quantity:1});
  await expect(f.scan()).rejects.toThrow('Маршрут показывает короб');
});
it('does not count tasks from obsolete request item rows',async()=>{
  const f=setup();f.tasks[1].requestItemId='deleted-item';await expect(f.scan()).rejects.toThrow('Маршрут показывает короб');
});
it('does not guess when relabeling uses this box SKU for another item',async()=>{
  const f=setup();f.tasks.push({id:'relabel',skuId:'other-sku',sourceSkuId:'picked-sku',status:'RESERVED',itemCount:1});
  await expect(f.scan()).rejects.toThrow('Маршрут показывает короб');
});
it('keeps successful switching ahead of the new message',async()=>{
  const f=setup();f.service.switchFbsTsdAssemblyToBox.mockResolvedValue({state:'SCAN_BARCODE'});
  expect(await f.scan()).toEqual({state:'SCAN_BARCODE'});expect(f.db.clientRequestItem.findMany).not.toHaveBeenCalled();
});
it('does not infer the contents of an empty box',async()=>{
  const f=setup();f.balances.length=0;await expect(f.scan()).rejects.toThrow('Маршрут показывает короб');
});
// TEST: the explanation must not depend on whether a next route has a recommended box.
it('explains fulfilled demand even without an assigned next box',async()=>{
  const f=setup();f.task.reservedBoxCode=null;
  await expect(f.scan()).rejects.toThrow('Нужное количество этого товара уже собрано');
});
it('does not present an over-count as confirmed completion',async()=>{
  const f=setup();f.tasks[1].itemCount=2;await expect(f.scan()).rejects.toThrow('Маршрут показывает короб');
});
it('does not treat goods absent from the request as already collected',async()=>{
  const f=setup();f.items.length=0;await expect(f.scan()).rejects.toThrow('Маршрут показывает короб');
});
it('explains multiple fully collected SKUs in a mixed box',async()=>{
  const f=setup();f.balances.push({skuId:'second',quantity:1});
  f.items.push({id:'second-item',skuId:'second',quantity:1});
  f.tasks.push({requestItemId:'second-item',skuId:'second',status:'COMPLETED',completedAt:new Date(),itemCount:1});
  await expect(f.scan()).rejects.toThrow('Нужное количество этих товаров уже собрано по заявке (3 из 3 шт.)');
});
it('uses request/client/warehouse filters and counts only matching item IDs',async()=>{
  const f=setup();await f.scan().catch(()=>{});
  expect(f.db.stockBalance.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{
    clientId:'client',warehouseId:'warehouse',boxId:'box',status:'AVAILABLE',quantity:{gt:0}}}));
  expect(f.db.clientRequestItem.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{
    requestId:'request',request:{clientId:'client',warehouseId:'warehouse'},skuId:{in:['picked-sku']},quantity:{gt:0}}}));
  expect(f.db.fbsTsdAssembly.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{requestId:'request',clientId:'client'}}));
});

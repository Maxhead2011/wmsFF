import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FbsOrderSelectionDto } from '../src/modules/marketplace-connections/dto/fbs-order-selection.dto';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: reproduce the first point search sent by the already-published browser.
describe('WB first shipping search', () => {
 afterEach(()=>vi.unstubAllEnvs());
 const base={clientId:'client',orders:[{connectionId:'cab',id:'1'}],shippingCity:'Moscow',plannedDeliveryDate:'2099-11-09'};
 it('accepts an unselected point from an older browser',async()=>{
  const dto=plainToInstance(FbsOrderSelectionDto,{...base,shippingPointId:''});
  expect(await validate(dto)).toEqual([]);expect(dto.shippingPointId).toBeUndefined();
 });
 it('still rejects malformed non-empty point IDs',async()=>{
  expect((await validate(plainToInstance(FbsOrderSelectionDto,{...base,shippingPointId:'wrong'}))).length).toBeGreaterThan(0);
 });
 it('opens the dialog without refreshing every client order',async()=>{
  vi.stubEnv('WMS_WB_SHIPPING_POINTS_ENABLED','true');
  const host:any=new MarketplaceConnectionsService({} as never,{requireClientAccess:vi.fn()} as never);
  host.resolveFbsShippingOrders=vi.fn().mockResolvedValue([{id:'1',connectionId:'cab',supplyId:'WB-GI-1',marketplace:'WILDBERRIES',supplierStatus:'confirm'}]);
  host.refreshFbsOrdersCache=vi.fn(()=>{throw Error('full client refresh forbidden')});
  host.resolveFbsSupplyDeliveryOptions=vi.fn().mockResolvedValue({supplies:[]});
  await expect(host.getFbsSupplyDeliveryOptions(base,{id:'user'})).resolves.toEqual({supplies:[]});
  expect(host.refreshFbsOrdersCache).not.toHaveBeenCalled();
 });
});

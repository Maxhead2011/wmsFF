import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: exercise the real manual WB flow, including partial external success.
function setup(options: { cargoFails?: boolean; refreshFails?: boolean; links?: any[] } = {}) {
  const orders = Array.from({length: 6}, (_, i) => ({id: String(100 + i), connectionId: 'conn',
    marketplace: 'WILDBERRIES', supplierStatus: 'new', category: 'active', warehouseId: 'warehouse',
    cargoType: '1', itemCount: 1, pickupPointShipmentAllowed: true, product: {id: `sku-${i}`}}));
  const response = {client: {code: 'CL-test'}, orders};
  const prisma = {fbsSupplyPlan: {upsert: vi.fn(), update: vi.fn()},
    fbsOrderRequestLink: {findMany: vi.fn().mockResolvedValue(options.links ?? [])}};
  const service = new MarketplaceConnectionsService(prisma as never, {requireClientAccess: vi.fn()} as never);
  vi.spyOn(service as any, 'resolveSelectedFbsOrders').mockResolvedValue({orders, response});
  vi.spyOn(service as any, 'loadFbsDeliveryPlan').mockResolvedValue({destination: 'PICKUP_POINT'});
  vi.spyOn(service as any, 'loadSelectedConnections').mockResolvedValue([{id:'conn', apiKey:'test'}]);
  vi.spyOn(service as any, 'resolveFbsRequestWarehouseId').mockResolvedValue('branch');
  vi.spyOn(service as any, 'refreshFbsOrdersCache').mockImplementation(async () => {
    if(options.refreshFails) throw Error('refresh failed');
    return response;
  });
  const create = vi.spyOn(service, 'createFbsRequest').mockResolvedValue({request:{number:10},linkedOrders:6} as never);
  const fetchMock = vi.fn(async (url: string) => {
    if(url.endsWith('/trbx') && options.cargoFails) throw Error('cargo failed');
    return {ok:true,status:200,json:async()=>url.endsWith('/order-ids')?{orderIds:orders.map(o=>Number(o.id))}:
      url.endsWith('/trbx')?{trbxIds:['cargo']}:{id:'WB-GI-test'}} as Response;
  });
  vi.stubGlobal('fetch',fetchMock);
  const run = () => service.assembleFbsOrders({clientId:'client',orders:orders.map(o=>({id:o.id,connectionId:o.connectionId}))} as never,{id:'owner'} as never);
  return {service, orders, create, run, fetchMock};
}
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('manual supply creates WMS request',()=>{
  it('links all six orders immediately after verified WB membership',async()=>{
    vi.stubEnv('WMS_FBS_MANUAL_SUPPLY_REQUEST_ENABLED','true');
    const s=setup();await s.run();
    expect(s.create).toHaveBeenCalledTimes(1);
    expect(s.create.mock.calls[0][0].orders).toHaveLength(6);
    expect(s.create.mock.calls[0][2]?.orders.every(o=>o.supplyId==='WB-GI-test' && o.supplierStatus==='confirm')).toBe(true);
    expect(s.orders.every(o=>o.supplierStatus==='new')).toBe(true);
  });
  it.each(['cargoFails','refreshFails'] as const)('creates WMS before %s can fail',async(key)=>{
    vi.stubEnv('WMS_FBS_MANUAL_SUPPLY_REQUEST_ENABLED','true');
    const s=setup({[key]:true});await expect(s.run()).rejects.toThrow();expect(s.create).toHaveBeenCalledTimes(1);
  });
  it('keeps sold/default-off behavior',async()=>{
    vi.stubEnv('WMS_FBS_MANUAL_SUPPLY_REQUEST_ENABLED','false');
    const s=setup();await s.run();expect(s.create).not.toHaveBeenCalled();
  });
  it('does not duplicate existing active request links',async()=>{
    vi.stubEnv('WMS_FBS_MANUAL_SUPPLY_REQUEST_ENABLED','true');
    const s=setup({links:Array.from({length:6},(_,i)=>({connectionId:'conn',orderId:String(100+i),syncStatus:'ACTIVE',request:{status:'SUBMITTED'}}))});
    await s.run();expect(s.create).not.toHaveBeenCalled();
  });
  it('reports the created supply if WMS request creation fails',async()=>{
    vi.stubEnv('WMS_FBS_MANUAL_SUPPLY_REQUEST_ENABLED','true');
    const s=setup();s.create.mockRejectedValue(Error('DB unavailable'));
    await expect(s.run()).rejects.toThrow(/WB-GI-test.*WMS/);
  });
  it('links only orders without an existing active request',async()=>{
    vi.stubEnv('WMS_FBS_MANUAL_SUPPLY_REQUEST_ENABLED','true');
    const s=setup({links:[{connectionId:'conn',orderId:'100',syncStatus:'ACTIVE',request:{status:'SUBMITTED'}}]});
    await s.run();
    expect(s.create.mock.calls[0][0].orders.map(o=>o.id)).toEqual(['101','102','103','104','105']);
  });
  it('rejects an unmapped product before creating a WB supply',async()=>{
    vi.stubEnv('WMS_FBS_MANUAL_SUPPLY_REQUEST_ENABLED','true');
    const s=setup();s.orders[0].product=null as never;
    await expect(s.run()).rejects.toThrow(/карточки товаров/);
    expect(s.fetchMock).not.toHaveBeenCalled();
  });
  it('rejects administrator-removed orders before any WB write',async()=>{
    vi.stubEnv('WMS_FBS_MANUAL_SUPPLY_REQUEST_ENABLED','true');
    vi.stubEnv('WMS_REQUEST_REMOVAL_ENABLED','true');
    const s=setup({links:[{orderId:'100'}]});
    await expect(s.run()).rejects.toThrow(/удалена администратором/);
    expect(s.fetchMock).not.toHaveBeenCalled();
  });
});

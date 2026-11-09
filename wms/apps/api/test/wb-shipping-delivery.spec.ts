import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/modules/marketplace-connections/wb-shipping-workflow', () => ({
  withWbShippingLock: async (_host: unknown, _connection: string, _supply: string, action: () => Promise<unknown>) => action(),
  assertShippingBeforeDelivery: async () => { throw new Error('Пункт сдачи недоступен'); },
  wbShippingWorkflow: vi.fn(),
}));
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

describe('WB shipping configuration rejection', () => {
  // TEST: no emergency rescan/recovery or stock lifecycle after a point-validation error.
  it('reports the point error without starting repeat assembly', async () => {
    const order = { id:'1', connectionId:'cab', supplyId:'WB-GI-QA', marketplace:'WILDBERRIES', supplierStatus:'confirm' };
    const response = { orders:[order] };
    const service:any = new MarketplaceConnectionsService({ fbsSupplyPlan:{ findFirst:vi.fn().mockResolvedValue({id:'plan',deliveryDestination:'VNUKOVO_SORTING_CENTER'}) } } as never, {requireClientAccess:vi.fn()} as never);
    vi.spyOn(service,'refreshFbsOrdersCache').mockResolvedValue(response);
    vi.spyOn(service,'resolveSelectedFbsOrders').mockResolvedValue({response,orders:[order]});
    vi.spyOn(service,'resolveFbsSupplyDeliveryOptions').mockResolvedValue({blockers:[],requiredDestinationOfficeId:'1',offices:[{id:'1'}]});
    vi.spyOn(service,'assertFbsDeliveryReadiness').mockResolvedValue(undefined);
    vi.spyOn(service,'loadSelectedConnections').mockResolvedValue([{id:'cab',apiKey:'synthetic'}]);
    const recover=vi.spyOn(service,'prepareFbsDeliveryRecovery').mockResolvedValue({rescanOrders:[],cancelledOrders:[]});
    const result=await service.deliverFbsSupplies({clientId:'client',orders:[{connectionId:'cab',id:'1'}],destinationOfficeId:'1',plannedDeliveryDate:'2099-11-09'},{id:'user'});
    expect(result.delivered).toBe(0);expect(result.failed[0].message).toContain('Пункт сдачи');
    expect(recover).not.toHaveBeenCalled();
  });
});

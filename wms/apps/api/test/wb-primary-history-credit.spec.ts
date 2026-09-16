import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => vi.unstubAllEnvs());
function setup(attempt?: string, flag = 'true') {
  vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', flag);
  const line = { key: 'WHITE', description: 'Primary', quantity: 1, unitPriceRub: 27,
    serviceId: null, serviceCode: 'FBS_PRIMARY_WHITE', taxMode: 'INCLUDED', priceBeforeTaxRub: 27 };
  const orders = ['old', 'new'].map(id => ({ id, marketplace: 'WILDBERRIES', connectionId: 'connection',
    itemCount: 1, processingAttemptId: attempt }));
  const old = { id: 'old-charge', status: 'DRAFT', serviceId: null, sourceKey: 'old-source',
    metadata: { kind: 'FBS_PRIMARY_PROCESSING', shipmentKey: 'WILDBERRIES:connection:supply:old',
      orderIds: ['old'], serviceCode: 'FBS_PRIMARY_WHITE', processingType: 'WHITE' } };
  const db: any = { billingInvoice: { findUnique: vi.fn(async () => null), count: vi.fn(async () => 0),
    create: vi.fn(async ({data}) => ({id:'invoice', number:data.number, status:data.status})) },
    billingCharge: { findMany: vi.fn(async (q) => q.where.sourceKey ? [] : [old]),
      create: vi.fn(async ({data}) => ({id:data.sourceKey,...data})), updateMany: vi.fn() } };
  const service: any = new MarketplaceConnectionsService(db, {} as never);
  const input: any = { clientId:'client', shipmentKey:'WILDBERRIES:connection:date:new', shipmentOrders:orders,
    shipmentItems:2, warehouseId:'warehouse', requestId:null, serviceDate:new Date(),
    lines:[{...line,quantity:2}], orderLines:orders.map(order=>({order,lines:[{...line}]})) };
  return {db,old,input,run:()=>service.ensureFbsPrimaryProcessingInvoiceLocked(input)};
}
// TEST: changing a WB supply/date must not bill the same physical primary work twice.
it('credits old primary work and records only the newly billed order',async()=>{
  const {db,run}=setup();await run();
  expect(db.billingCharge.create.mock.calls[0][0].data).toMatchObject({quantity:1,totalRub:27,
    metadata:{orderIds:['new'],lineQuantity:1}});
  expect(db.billingInvoice.create.mock.calls[0][0].data.totalRub).toBe(27);
});
it('bills an explicit repeat attempt separately',async()=>{
  const {db,run}=setup('repeat');await run();
  expect(db.billingCharge.create.mock.calls[0][0].data).toMatchObject({quantity:2,totalRub:54,
    metadata:{billingAttemptId:'repeat'}});
});
it('does not credit another service or another seller connection',async()=>{
  const {old,db,run}=setup();old.metadata.serviceCode='FBS_PRIMARY_GRAY';await run();
  expect(db.billingCharge.create.mock.calls[0][0].data.totalRub).toBe(54);
  const second=setup();second.old.metadata.shipmentKey='WILDBERRIES:other:supply:old';await second.run();
  expect(second.db.billingCharge.create.mock.calls[0][0].data.totalRub).toBe(54);
});
it('freezes an existing primary invoice after lifecycle activation',async()=>{
  const {db,run}=setup();db.billingInvoice.findUnique.mockResolvedValue({id:'existing',number:'1',status:'DRAFT'});
  await run();expect(db.billingCharge.create).not.toHaveBeenCalled();
});
it('preserves flag-off behavior for sold WMS',async()=>{
  const {db,run}=setup(undefined,'false');await run();
  expect(db.billingCharge.create.mock.calls[0][0].data.totalRub).toBe(54);
});

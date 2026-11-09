import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertShippingBeforeDelivery, wbShippingWorkflow } from '../src/modules/marketplace-connections/wb-shipping-workflow';

// TEST: cargo creation is additive, scoped, reconciled and printing-only stock-neutral.
describe('WB shipping workflow', () => {
  beforeEach(() => vi.stubEnv('WMS_WB_SHIPPING_POINTS_ENABLED', 'true'));
  afterEach(() => vi.unstubAllEnvs());
  function fixture() {
    let ids = ['box1'];
    const plan = { id: 'plan1', cargoPlaceIds: ids, deliveryDestination: 'PICKUP_POINT' };
    const host: any = {
      clientScopes: { requireClientAccess: vi.fn() }, refreshFbsOrdersCache: vi.fn().mockResolvedValue({}),
      resolveFbsShippingOrders: vi.fn().mockResolvedValue([{ id: 'order1', connectionId: 'cab1', supplyId: 'WB-GI-1', marketplace: 'WILDBERRIES', supplierStatus: 'confirm' }]),
      loadSelectedConnections: vi.fn().mockResolvedValue([{ id: 'cab1', apiKey: 'synthetic' }]),
      prisma: {
        $transaction: vi.fn((callback) => callback({ $executeRaw: vi.fn() })),
        fbsSupplyPlan: { findFirst: vi.fn().mockResolvedValue(plan), update: vi.fn().mockResolvedValue(plan) },
        auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
      },
    };
    const json = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('shipping-points?')) return { shippingPoints: [{ id: 42, available: true, officeType: 'pp' }] };
      if (url.endsWith('/order-ids')) return { orderIds: [1, 2, 3, 4] };
      if (url.endsWith('/trbx')) {
        if (init.method === 'POST') ids = [...ids, 'box2'];
        return { trbxes: ids.map((id) => ({ id })) };
      }
      return { shippingPointId: 42, shippingDt: '2099-11-09', shippingType: 'selfShipping' };
    });
    const dto = { clientId: 'client1', orders: [{ id: 'order1', connectionId: 'cab1' }], shippingCity: 'Москва', plannedDeliveryDate: '2099-11-09', cargoPlaceTotal: 2 };
    return { host, json, dto };
  }
  // TEST: searching a point must never perform the full operational refresh.
  it('searches only the selected supply without refreshing the client', async () => {
    const {host,json,dto}=fixture();
    await wbShippingWorkflow(host,dto,{id:'user'},'points',json);
    expect(host.refreshFbsOrdersCache).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledTimes(1);
  });
  it('checks scope before reading WB', async () => {
    const { host, json, dto } = fixture(); host.clientScopes.requireClientAccess.mockImplementation(() => { throw new Error('denied'); });
    await expect(wbShippingWorkflow(host, dto, { id: 'user' }, 'cargo', json)).rejects.toThrow('denied');
    expect(json).not.toHaveBeenCalled();
  });
  it('adds only the missing cargo and synchronizes exact IDs', async () => {
    const { host, json, dto } = fixture();
    await expect(wbShippingWorkflow(host, dto, { id: 'user' }, 'cargo', json)).resolves.toEqual({ saved: true, cargoPlaceIds: ['box1', 'box2'] });
    expect(json.mock.calls.filter(([, init]) => init.method === 'POST').map(([, init]) => JSON.parse(String(init.body)))).toEqual([{ amount: 1 }]);
    expect(host.prisma.fbsSupplyPlan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cargoPlaceIds: ['box1', 'box2'] }) }));
  });
  it('retries an already satisfied total without another POST', async () => {
    const { host, json, dto } = fixture(); dto.cargoPlaceTotal = 1;
    await wbShippingWorkflow(host, dto, { id: 'user' }, 'cargo', json);
    expect(json.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false);
  });
  it('blocks retry when the previous cargo outcome remains unknown', async () => {
    const { host, json, dto } = fixture();
    host.prisma.auditLog.findFirst.mockResolvedValueOnce({ createdAt: new Date(), payload: { target: 2 } }).mockResolvedValueOnce(null);
    await expect(wbShippingWorkflow(host, dto, { id: 'user' }, 'cargo', json)).rejects.toThrow('Повторное создание остановлено');
    expect(json.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false);
  });
  it('rejects counts beyond the WB limit before creating cargo', async () => {
    const { host, json, dto } = fixture(); dto.cargoPlaceTotal = 3;
    await expect(wbShippingWorkflow(host, dto, { id: 'user' }, 'cargo', json)).rejects.toThrow('не больше 2');
    expect(json.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false);
  });
  it('keeps the sold installation unchanged', async () => {
    vi.stubEnv('WMS_WB_SHIPPING_POINTS_ENABLED', 'false');
    const { host, json, dto } = fixture();
    await expect(wbShippingWorkflow(host, dto, { id: 'user' }, 'cargo', json)).rejects.toThrow('отключена');
    expect(json).not.toHaveBeenCalled();
  });
  it('blocks final delivery if WB point differs from the saved selection', async () => {
    const { host } = fixture();
    host.prisma.auditLog.findFirst.mockResolvedValue({ payload: { city: 'Москва', shippingPointId: '42' } });
    const request = vi.fn().mockResolvedValue({ shippingPointId: 43, shippingDt: '2099-11-09', shippingType: 'selfShipping' });
    await expect(assertShippingBeforeDelivery(host, 'plan1', 'WB-GI-1', '2099-11-09', request)).rejects.toThrow('изменились');
  });
  it('blocks final delivery for a newly created but unclosed cargo place', async () => {
    const { host } = fixture();
    host.prisma.auditLog.findFirst.mockResolvedValue({ payload: { city: 'Москва', shippingPointId: '42' } });
    host.prisma.fbsSupplyPlan.findUnique = vi.fn().mockResolvedValue({ clientId:'client1', connectionId:'cab1', cargoPlaceIds:['box1','box2'] });
    host.prisma.fbsCargoPlacePacking = { findMany: vi.fn().mockResolvedValue([{id:'pack1',cargoPlaceId:'box1'}]) };
    const request = vi.fn(async (url: string) => url.includes('shipping-points?')
      ? { shippingPoints: [{id:42,available:true,officeType:'pp'}] }
      : url.endsWith('/trbx') ? {trbxes:[{id:'box1'},{id:'box2'}]}
      : {shippingPointId:42,shippingDt:'2099-11-09',shippingType:'selfShipping'});
    await expect(assertShippingBeforeDelivery(host, 'plan1', 'WB-GI-1', '2099-11-09', request)).rejects.toThrow('Закройте все грузоместа');
  });
});

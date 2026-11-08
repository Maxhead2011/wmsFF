import { decorateFabricReservationResponse } from './fbs-fabric-reservation';
import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsController } from './marketplace-connections.controller';
import { identifyFabricSku, fabricMaterialAvailability } from '../warehouse/fabric-fbs-availability';
afterEach(() => vi.unstubAllEnvs());
// TEST: the actual HTTP controller must decorate the scoped saved response, including cold cache rows.
it('applies fabric mode after cabinet/branch scoping without replacing response metadata', async () => {
 const scoped = { orders: [{ id: 'order', reservation: null, storageBoxes: [] }], sync: { partial: true }, fetchedAt: '' };
 const decorated = { ...scoped, orders: [{ ...scoped.orders[0], reservation: { status: 'FABRIC_ON_DEMAND', withoutBox: true } }] };
 const service = { listFbsOrders: vi.fn(async () => scoped), decorateFbsFabricDisplay: vi.fn(async () => decorated) };
 const controller: any = Object.create(MarketplaceConnectionsController.prototype); controller.connections = service;
 const response = await controller.listFbsOrders({ id: 'user' }, 'client', undefined);
 expect(service.decorateFbsFabricDisplay).toHaveBeenCalledWith('client', scoped);
 expect(response.orders[0].reservation?.status).toBe('FABRIC_ON_DEMAND');
 expect(response.sync).toEqual({ partial: true });
});
// TEST: exact blue article must use blue metres, never another colour or warehouse.
it('recognizes blue cuts and preserves material shortage checks', () => {
 const sku = { id: 'blue', name: 'Ткань атлас сатин синий 5 метров', internalSku: 'blue_5-0' };
 expect(identifyFabricSku(sku)).toMatchObject({ material: 'SATIN', color: 'blue', lengthMm: 5000 });
 const roll = { id: 'r', warehouseId: 'w', material: 'SATIN', color: 'blue', remainingMm: 100000, cutMm: 0, createdAt: '2026-11-08' };
 expect(fabricMaterialAvailability({ rolls: [roll] }, sku, 'w', 20)).toMatchObject({ available: true, totalMm: 100000 });
 expect(fabricMaterialAvailability({ rolls: [roll] }, sku, 'w', 21)).toMatchObject({ available: false, reason: 'INSUFFICIENT_MATERIAL' });
 expect(fabricMaterialAvailability({ rolls: [{ ...roll, color: 'white' }] }, sku, 'w', 1).available).toBe(false);
});

function savedFixture() {
 vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true');
 const sku = { id: 'sku', clientId: 'client', name: 'Ткань белая', internalSku: 'white_1-0' };
 const order = { id: 'order', connectionId: 'shop', marketplace: 'WILDBERRIES', category: 'active', supplierStatus: 'confirm', product: sku, reservation: null, storageBoxes: [] };
 const tasks = vi.fn(async () => [{ connectionId: 'shop', orderId: 'order', status: 'WAITING_STOCK' } as any]);
 const db = { fbsTsdAssembly: { findMany: tasks }, sku: { findMany: vi.fn(async () => [sku]) }, systemSetting: { findUnique: vi.fn(async () => ({ value: { enabled: true } })) } };
 return { order, db, tasks };
}
// TEST: cold/merged snapshots acquire mode without mutating cache or claiming material stock.
it('decorates saved rows without mutating the cache and preserves sync metadata', async () => {
 const f = savedFixture();const response = { orders: [f.order], sync: { partial: true, error: 'WB unavailable' } };
 const result = await decorateFabricReservationResponse(f.db, 'client', response);
 expect(result.orders[0].reservation).toMatchObject({ status: 'FABRIC_ON_DEMAND', withoutBox: true });
 expect(response.orders[0].reservation).toBeNull();expect(result.sync).toBe(response.sync);
 expect(f.tasks).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: 'client', connectionId: { in: ['shop'] }, orderId: { in: ['order'] } }) }));
});
it.each([{ status: 'IN_PROGRESS', barcode: 'scan' }, { status: 'WAITING_STOCK', reservedBoxId: 'box' }, { status: 'WAITING_STOCK', requiresKiz: true }])('does not hide fresh physical/marking evidence %j', async patch => {
 const f = savedFixture();f.tasks.mockResolvedValue([{ connectionId: 'shop', orderId: 'order', ...patch }]);
 const result = await decorateFabricReservationResponse(f.db, 'client', { orders: [{ ...f.order, reservation: { status: 'FABRIC_ON_DEMAND' } }] });
 expect(result.orders[0].reservation).toBeNull();
});
it('keeps ordinary and disabled-client rows unchanged', async () => {
 const f = savedFixture();const response = { orders: [f.order] };
 f.db.systemSetting.findUnique.mockResolvedValue({ value: { enabled: false } });
 expect((await decorateFabricReservationResponse(f.db, 'client', response)).orders[0]).toBe(f.order);
 vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'false');
 expect(await decorateFabricReservationResponse(null, 'client', response)).toBe(response);
});

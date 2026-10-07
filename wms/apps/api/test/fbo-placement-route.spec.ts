import { afterEach, expect, it, vi } from 'vitest';
import { FboTwoStageService } from '../src/modules/tsd/fbo-two-stage.service';
vi.mock('../src/modules/tsd/fbo-request-route', async importOriginal => ({ ...await importOriginal<any>(), loadFboRoutePreference: async () => null }));
vi.mock('../src/modules/tsd/fbo-fbs-reservations', () => ({ loadFboFbsAvailability: async () => ({ free: () => 3, take: () => {} }) }));
afterEach(() => vi.unstubAllEnvs());
// TEST: placing a previously accepted box makes the route available without recreating the request.
it('waits for placement and automatically includes the placed box on refresh', async () => {
  vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
  const box: any = { id: 'box', code: 'FFL_LKB0610_1', balances: [{ skuId: 's', status: 'AVAILABLE', quantity: 3 }], productMarks: [], storagePlacement: null };
  const tx: any = { fboAssembly: { findUnique: async () => null }, user: { findMany: async () => [] }, box: { findMany: async () => [box] } };
  const service: any = new FboTwoStageService(tx, {} as any, {} as any, {} as any, {} as any, {} as any);
  service.busyBoxes = async () => new Set();
  const request: any = { id: 'r', clientId: 'c', warehouseId: 'w', client: { stockBalanceMode: 'PALLET_SORT' },
    items: [{ id: 'i', skuId: 's', barcode: '123', quantity: 3, sku: { name: 'Suit' } }] };
  const waiting = await service.snapshot(tx, request);
  expect(waiting.route).toEqual([]);
  expect(waiting.pendingPlacementQuantity).toBe(3);
  expect(waiting.shortage).toBe(0);
  box.storagePlacement = { pallet: { code: 'PALET_SORT_1' } };
  const ready = await service.snapshot(tx, request);
  expect(ready.pendingPlacementQuantity).toBe(0);
  expect(ready.route).toHaveLength(1);
  expect(ready.route[0]).toMatchObject({ boxCode: box.code, pallet: 'PALET_SORT_1' });
});

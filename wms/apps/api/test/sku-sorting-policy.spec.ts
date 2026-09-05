import { afterEach, expect, it, vi } from 'vitest';
import { skuSortingAllowed } from '../src/modules/inventory/sku-sorting-policy';
import { SkuCollectionService } from '../src/modules/inventory/sku-collection.service';
afterEach(() => vi.unstubAllEnvs());
it('allows only the authenticated pilot device AND exact request with global mode off', () => {
  // TEST: another device, web session or request cannot enter Sonya's pilot.
  vi.stubEnv('WMS_SKU_SORTING_ENABLED', 'false');
  vi.stubEnv('WMS_SKU_SORTING_PILOT_DEVICE_ID', 'sonya-device');
  vi.stubEnv('WMS_SKU_SORTING_PILOT_REQUEST_ID', 'request-633');
  expect(skuSortingAllowed({ deviceId: 'sonya-device' }, 'request-633')).toBe(true);
  expect(skuSortingAllowed({ deviceId: 'other' }, 'request-633')).toBe(false);
  expect(skuSortingAllowed({}, 'request-633')).toBe(false);
  expect(skuSortingAllowed({ deviceId: 'sonya-device' }, 'other')).toBe(false);
  vi.stubEnv('WMS_SKU_SORTING_PILOT_DEVICE_ID', '');
  expect(skuSortingAllowed({}, 'request-633')).toBe(false);
});
it('retains explicitly enabled global mode', () => {
  // TEST: the existing opt-in rollout remains compatible.
  vi.stubEnv('WMS_SKU_SORTING_ENABLED', 'true');
  expect(skuSortingAllowed({}, 'request')).toBe(true);
});
it('rejects legacy receiving of an already converted pilot request from another device', async () => {
  // TEST: the old receive route must not bypass the device restriction.
  vi.stubEnv('WMS_SKU_SORTING_ENABLED', 'false');
  const tx: any = {
    $queryRaw: vi.fn(),
    skuCollectionScan: { findUnique: vi.fn().mockResolvedValue({ status: 'RECEIVED', targetBoxCode: 'TARGET' }) },
  };
  const service = new SkuCollectionService({ ...tx, $transaction: (fn: any) => fn(tx) } as any, {} as any, {} as any);
  vi.spyOn(service as any, 'requireRequest').mockResolvedValue({ comment: '[SKU_SORTING_V2]' });
  vi.spyOn(service as any, 'summary').mockResolvedValue({ id: 'request' });
  await expect(service.receive('request', { barcode: '123', kiz: 'kiz', targetBoxCode: 'TARGET' }, {} as any))
    .rejects.toThrow('пилот');
});

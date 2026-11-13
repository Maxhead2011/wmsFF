import { afterEach, expect, it, vi } from 'vitest';
import { queueClientKizReview } from '../src/common/kiz-client-review';

afterEach(() => vi.unstubAllEnvs());
// TEST: rollback removes the candidate pick, but its review must remain visible to administrators.
it('queues a rejected mark for the pending secondary line without recording a pick', async () => {
  vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED', 'true');
  vi.stubEnv('WMS_OZON_UNIT_MARKS_ENABLED', 'true');
  vi.stubEnv('WMS_OZON_TSD_UNIT_MARKS_ENABLED', 'true');
  const state = { version: 1, unitMarksVersion: 1, submission: 'PICKING', pendingBarcode: 'b',
    source: { boxId: 'box', boxCode: 'BOX' }, lines: [
      { productId: 1, skuId: 'a', requestItemId: 'a', quantity: 1, requiresKiz: false, picks: [{ barcode: 'a' }] },
      { productId: 2, skuId: 'b', requestItemId: 'b', quantity: 1, requiresKiz: true, barcodes: ['b'], picks: [] },
    ] };
  const db: any = {
    $queryRaw: vi.fn(async () => [{ data: state }]),
    clientRequest: { findUnique: vi.fn(async () => ({ id: 'r', clientId: 'c', warehouseId: 'w', status: 'IN_WORK' })) },
    fbsTsdAssembly: { findUnique: vi.fn(async () => ({ id: 't', requestId: 'r', clientId: 'c', marketplace: 'OZON', itemCount: 2, skuId: 'a' })) },
    shippedKizHistory: { findMany: vi.fn(async () => []) }, fboAssemblyUnit: { findMany: vi.fn(async () => []) },
    productMark: { findMany: vi.fn(async () => []) },
    kizReviewCase: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({ id: 'review', status: 'OPEN' })) },
    auditLog: { create: vi.fn() },
  };
  db.$transaction = (action: any) => action(db);
  const input: any = { scope: 'FBS', clientId: 'c', warehouseId: 'w', requestId: 'r', taskId: 't', skuId: 'b', boxId: 'box', kiz: '0104610460840540215K.W,b' };
  await expect(queueClientKizReview(db, input, { id: 'u' })).resolves.toMatchObject({ status: 'OPEN' });
  expect(state.lines[1].picks).toHaveLength(0);
  await expect(queueClientKizReview(db, { ...input, boxId: 'other' }, { id: 'u' })).rejects.toThrow();
  expect(db.kizReviewCase.upsert).toHaveBeenCalledTimes(1);
});

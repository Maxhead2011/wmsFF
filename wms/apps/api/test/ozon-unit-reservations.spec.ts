import { describe, expect, it, vi } from 'vitest';
import { ozonUnitReservationRows } from '../src/common/ozon-unit-reservations';
import { loadFboFbsAvailability } from '../src/modules/tsd/fbo-fbs-reservations';

// TEST: the second product must reserve its own SKU, not inflate the first SKU.
describe('Ozon unit reservations', () => {
  const task = { id: 't', marketplace: 'OZON', skuId: 'a', itemCount: 3, boxId: null };
  const state = { unitMarksVersion: 1, lines: [
    { skuId: 'a', quantity: 1, picks: [{ boxId: 'box-a' }] },
    { skuId: 'b', quantity: 2, picks: [{ boxId: 'box-b' }] },
  ] };
  it('preserves picked sources and reserves remaining demand separately', () => {
    expect(ozonUnitReservationRows(task, state)).toEqual([
      expect.objectContaining({ skuId: 'a', boxId: 'box-a', itemCount: 1 }),
      expect.objectContaining({ skuId: 'b', boxId: 'box-b', itemCount: 1 }),
      expect.objectContaining({ skuId: 'b', boxId: null, itemCount: 1 }),
    ]);
  });
  it('falls through for legacy tasks and rejects corrupt quantities', () => {
    expect(ozonUnitReservationRows(task, null)).toBeNull();
    expect(() => ozonUnitReservationRows({ ...task, itemCount: 4 }, state)).toThrow();
  });
  // TEST: actual FBO loader must protect the second product of an Ozon order.
  it('does not offer reserved secondary products to FBO', async () => {
    vi.stubEnv('WMS_OZON_UNIT_MARKS_ENABLED', 'true');
    vi.stubEnv('WMS_OZON_TSD_UNIT_MARKS_ENABLED', 'true');
    vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED', 'false');
    const empty = { findMany: async () => [] };
    const tx = {
      stockBalance: { findMany: async () => [{ boxId: 'box-b', skuId: 'b', quantity: 2 }] },
      clientRequest: { findMany: async () => [{ id: 'request' }] },
      fbsTsdAssembly: { findMany: async () => [{ ...task, requestId: 'request', status: 'IN_PROGRESS' }] },
      stockMovement: empty, fbsOrderRequestLink: empty, systemSetting: empty,
      $queryRaw: async () => [{ data: state }],
    };
    try {
      const available = await loadFboFbsAvailability(tx as never, { clientId: 'client', warehouseId: 'wh' }, ['b']);
      expect(available.free('box-b', 'b')).toBe(0);
    } finally { vi.unstubAllEnvs(); }
  });
});

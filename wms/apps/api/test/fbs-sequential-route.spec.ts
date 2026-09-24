import { expect, it, vi, afterEach } from 'vitest';
import { fbsLocationRank, fbsSequentialEnabled, fbsContinuationBox } from '../src/modules/marketplace-connections/fbs-sequential-route';
afterEach(() => vi.unstubAllEnvs());
// TEST: the same box must win over another box on the same pallet.
it('orders box, current pallet, then other locations', () => {
  const pallet = new Set(['A', 'B']);
  expect(['C', 'B', 'A'].sort((a, b) => fbsLocationRank([b], 'A', pallet) - fbsLocationRank([a], 'A', pallet)))
    .toEqual(['A', 'B', 'C']);
});
it('is opt-in and preserves sold deployment by default', () => {
  vi.stubEnv('WMS_FBS_SEQUENTIAL_PICK_ENABLED', ''); expect(fbsSequentialEnabled()).toBe(false);
  vi.stubEnv('WMS_FBS_SEQUENTIAL_PICK_ENABLED', 'true'); expect(fbsSequentialEnabled()).toBe(true);
});
// TEST: next-order formatting must not replace the selected box with another smaller box.
it('continues only in an eligible box with enough unreserved units', () => {
  const boxes = [{ code: 'B', quantity: 1 }, { code: 'A', quantity: 3 }];
  vi.stubEnv('WMS_FBS_SEQUENTIAL_PICK_ENABLED', 'true');
  expect(fbsContinuationBox(boxes, 'A', 1)?.code).toBe('A');
  expect(fbsContinuationBox(boxes, 'A', 4)).toBeUndefined();
  expect(fbsContinuationBox(boxes, 'foreign', 1)).toBeUndefined();
  vi.stubEnv('WMS_FBS_SEQUENTIAL_PICK_ENABLED', 'false');
  expect(fbsContinuationBox(boxes, 'A', 1)).toBeUndefined();
});

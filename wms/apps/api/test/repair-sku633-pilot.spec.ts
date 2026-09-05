import { expect, it } from 'vitest';
import { validate633Facts } from '../src/scripts/repair-sku633-pilot';
const valid = { available: 7, reserved: 7, moved: [2, 4, 1], ownReserve: 31, picked: 17, received: 0, totalPlan: 55, blockers: 0 };
it('keeps seven physical units, releases only own remaining reserve and preserves 17 picked', () => {
  // TEST: correcting 14 recorded to 7 physical is -7, never +7 AVAILABLE.
  expect(validate633Facts(valid)).toEqual({ correction: -7, release: 31, targetPlan: 7, totalPlan: 55 });
});
it.each(['available', 'reserved', 'ownReserve', 'picked', 'received', 'totalPlan', 'blockers'])('rejects changed %s before any write', key => {
  // TEST: a stale/foreign snapshot cannot be applied.
  expect(() => validate633Facts({ ...valid, [key]: (valid as any)[key] + 1 })).toThrow();
});
it('rejects changed consolidation quantities', () => {
  // TEST: matching a total alone is insufficient to prove the three source transfers.
  expect(() => validate633Facts({ ...valid, moved: [3, 3, 1] })).toThrow();
});

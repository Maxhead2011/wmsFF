import { afterEach, expect, it, vi } from 'vitest';
import { wholeBoxDecision, prioritizeFboWholeBoxes } from '../src/modules/tsd/fbo-two-stage-policy';
afterEach(() => vi.unstubAllEnvs());
const balances = [
  { skuId: 'black', quantity: 14, status: 'AVAILABLE' },
  { skuId: 'brown', quantity: 4, status: 'AVAILABLE' },
];
const marks = balances.flatMap(b => Array.from({ length: b.quantity }, (_, i) => ({ skuId: b.skuId, identity: `${b.skuId}-${i}`, status: 'AVAILABLE' })));
// TEST: 0409_475 after moving its surplus contains exactly the remaining 14 + 4 units of request 1029.
it('allows a reconciled mixed box only when every SKU fits the remaining demand', () => {
  vi.stubEnv('WMS_FBO_MIXED_WHOLE_BOX_ENABLED', 'true');
  expect(wholeBoxDecision(balances, { black: 14, brown: 4 }, marks, true)).toEqual({ allowed: true, recount: false, quantity: 18 });
  for (const demand of [{ black: 14, brown: 3 }, { black: 13, brown: 5 }, { black: 18 }])
    expect(wholeBoxDecision(balances, demand, marks, true).allowed).toBe(false);
  expect(wholeBoxDecision([...balances, { skuId: 'extra', quantity: 1, status: 'AVAILABLE' }], { black: 14, brown: 4 }, marks, true).allowed).toBe(false);
});
// TEST: equal total counts must not hide a missing/wrong-SKU KIZ, duplicate identity or reserved stock.
it('checks mark identities and counts for each SKU', () => {
  vi.stubEnv('WMS_FBO_MIXED_WHOLE_BOX_ENABLED', 'true');
  for (const invalid of [marks.slice(1), [...marks.slice(1), marks[1]], marks.map((m, i) => i === 0 ? { ...m, skuId: 'brown' } : m), marks.map((m, i) => i === 0 ? { ...m, status: 'PACKING' } : m)])
    expect(wholeBoxDecision(balances, { black: 14, brown: 4 }, invalid, true)).toMatchObject({ allowed: false, recount: true });
  expect(wholeBoxDecision(balances.map((b, i) => i ? { ...b, status: 'RESERVED' } : b), { black: 14, brown: 4 }, marks, true).allowed).toBe(false);
  expect(wholeBoxDecision([], {}, [], false).allowed).toBe(false);
});
// TEST: whole-box priority must subtract every SKU, not the total quantity from the first SKU.
it('prioritizes an exact mixed box and conserves demand for following boxes', () => {
  vi.stubEnv('WMS_FBO_MIXED_WHOLE_BOX_ENABLED', 'true');
  const make = (id: string, quantities: number[]) => ({ id, balances: balances.map((b, i) => ({ ...b, quantity: quantities[i] })).filter(b => b.quantity), productMarks: [] });
  const mixed = make('mixed', [14, 4]), extraBrown = make('too-much-brown', [0, 1]), black = make('remaining-black', [1, 0]);
  const demand = { black: 15, brown: 4 };
  expect(prioritizeFboWholeBoxes([extraBrown, mixed, black], demand, (b, d) => wholeBoxDecision(b.balances, d, [], false)).map(b => b.id))
    .toEqual(['mixed', 'remaining-black', 'too-much-brown']);
  expect(demand).toEqual({ black: 15, brown: 4 });
});
// TEST: sold/default installations retain the single-SKU restriction.
it('keeps mixed boxes disabled without the installation flag', () => {
  vi.stubEnv('WMS_FBO_MIXED_WHOLE_BOX_ENABLED', 'false');
  expect(wholeBoxDecision(balances, { black: 14, brown: 4 }, marks, true).allowed).toBe(false);
});

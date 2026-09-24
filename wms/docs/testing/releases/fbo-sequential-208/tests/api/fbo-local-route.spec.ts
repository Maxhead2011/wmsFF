import { describe, expect, it } from 'vitest';
import { prioritizeFboLocation } from '../src/modules/tsd/fbo-local-route';
import { prioritizeFboWholeBoxes, wholeBoxDecision } from '../src/modules/tsd/fbo-two-stage-policy';
const box = (code: string, quantity: number, pallet = '1002') => ({ code, pallet: { code: pallet },
  balances: [{ skuId: 's', quantity, status: 'AVAILABLE' }], productMarks: [] });
type Box = ReturnType<typeof box>;
const whole = (boxes: Box[], demand: Record<string, number>) => prioritizeFboWholeBoxes(boxes, demand,
  (b, d) => wholeBoxDecision(b.balances, d, [], false));
const route = (boxes: Box[], n: number, sourceBoxCode = 'A', palletCode = '1002') =>
  prioritizeFboLocation(boxes, { s: n }, { sourceBoxCode, palletCode }, whole);
describe('FBO current physical location', () => {
  // TEST: request 1221 used to redirect from A (2 left) to B (exactly 3).
  it('finishes A before switching to an exact whole box', () => {
    const boxes = [box('A', 2), box('B', 3, '1006')];
    expect(whole(boxes, { s: 3 })[0].code).toBe('B');
    expect(route(boxes, 3).map(b => b.code)).toEqual(['A', 'B']);
    expect(route([box('A', 1), boxes[1]], 2)[0].code).toBe('A');
  });
  it('finishes this pallet before another and preserves demand for later boxes', () => {
    expect(route([box('A', 1), box('C', 2), box('B', 3, '1006')], 4).map(b => b.code))
      .toEqual(['A', 'C', 'B']);
  });
  it('never adds a missing/busy box, trusts actual pallet placement and keeps legacy order without hints', () => {
    const boxes = [box('C', 1), box('B', 3, '1006')];
    expect(route(boxes, 3).map(b => b.code)).toEqual(['C', 'B']);
    expect(route(boxes, 3, 'B')[0].code).toBe('C');
    expect(prioritizeFboLocation(boxes, { s: 3 }, {}, whole)[0].code).toBe('B');
  });
  it('does not mutate input balances or demand', () => {
    const boxes = [box('A', 2), box('B', 3)]; const demand = { s: 3 };
    prioritizeFboLocation(boxes, demand, { palletCode: '1002', sourceBoxCode: 'A' }, whole);
    expect(demand.s).toBe(3); expect(boxes[0].balances[0].quantity).toBe(2);
  });
});

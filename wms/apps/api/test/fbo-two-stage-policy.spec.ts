import { describe, expect, it } from 'vitest';
import { wholeBoxDecision, remainingFboLines } from '../src/modules/tsd/fbo-two-stage-policy';
describe('FBO physical picking', () => {
    // TEST: a homogeneous box cannot be taken wholesale when demand is smaller.
    it('requires individual scans for a 20-unit box when only five are required', () => {
        expect(wholeBoxDecision([{ skuId: 's', quantity: 20, status: 'AVAILABLE' }], { s: 5 }, [], false).allowed).toBe(false);
    });
    it('requires a recount when a marked box has fewer KIZs than stock', () => {
        expect(wholeBoxDecision([{ skuId: 's', quantity: 2, status: 'AVAILABLE' }], { s: 2 }, [{ skuId: 's', identity: 'a', status: 'AVAILABLE' }], true)).toMatchObject({ allowed: false, recount: true });
    });
    it('accepts a reconciled whole box and rejects duplicate physical marks', () => {
        const balances = [{ skuId: 's', quantity: 2, status: 'AVAILABLE' }];
        const marks = ['a', 'b'].map(identity => ({ skuId: 's', identity, status: 'AVAILABLE' }));
        expect(wholeBoxDecision(balances, { s: 2 }, marks, true).allowed).toBe(true);
        expect(wholeBoxDecision(balances, { s: 2 }, [marks[0], marks[0]], true).allowed).toBe(false);
    });
    it('never takes mixed contents or reserved units as a whole box', () => {
        for (const other of [{ skuId: 'x', quantity: 1, status: 'AVAILABLE' }, { skuId: 's', quantity: 1, status: 'RESERVED' }]) {
            expect(wholeBoxDecision([{ skuId: 's', quantity: 2, status: 'AVAILABLE' }, other], { s: 5, x: 5 }, [], false).allowed).toBe(false);
        }
    });
    it('counts packed units as already picked and excludes explicitly returned units', () => {
        expect(remainingFboLines([{ id: 'line', skuId: 's', quantity: 3 }], [
            { requestItemId: 'line', state: 'PACKED' }, { requestItemId: 'line', state: 'PICKED' }, { requestItemId: 'line', state: 'RETURNED' },
        ])[0]).toMatchObject({ needed: 3, picked: 2, packed: 1, remaining: 1 });
    });
});

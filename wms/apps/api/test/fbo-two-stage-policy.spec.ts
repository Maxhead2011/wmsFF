import { describe, expect, it } from 'vitest';
import { wholeBoxDecision, remainingFboLines, prioritizeFboWholeBoxes } from '../src/modules/tsd/fbo-two-stage-policy';
describe('FBO physical picking', () => {
    // TEST: reproduce 1509_27 (one needed unit) before 1509_31 (all 19 needed units).
    it('prioritizes an exact 19-unit box without consuming demand on the mixed box', () => {
        const box = (code: string, n: number, mixed = false) => ({ code,
            balances: [{ skuId: 's', quantity: n, status: 'AVAILABLE' }, ...(mixed ? [{ skuId: 'other', quantity: 2, status: 'AVAILABLE' }] : [])],
            productMarks: Array.from({ length: n }, (_, i) => ({ skuId: 's', status: 'AVAILABLE', identity: `${code}:${i}` })),
        });
        const mixed = box('1509_27', 1, true), whole = box('1509_31', 19), tooBig = box('OTHER', 20);
        const decide = (b: ReturnType<typeof box>, demand: Record<string, number>) => wholeBoxDecision(b.balances, demand, b.productMarks, true);
        const demand = { s: 19 };
        expect(prioritizeFboWholeBoxes([mixed, tooBig, whole], demand, decide).map(b => b.code)).toEqual(['1509_31', '1509_27', 'OTHER']);
        expect(demand).toEqual({ s: 19 });
        // A broken KIZ list must not gain whole-box priority.
        whole.productMarks.pop();
        expect(prioritizeFboWholeBoxes([mixed, whole], demand, decide)[0]).toBe(mixed);
    });
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

import { describe, expect, it } from 'vitest';
import { validateDoubleConsumptionRepair } from '../src/scripts/repair-fbs-double-consumption';

// TEST: recovery needs ledger evidence AND a current physical count, never marks alone.
describe('double consumption repair safety', () => {
  const valid = { available: 0, physical: 2, duplicate: 2, unprotectedMarks: 2,
    activePlacedBox: true, laterRecount: false, activeWork: false, fullyPickedBeforeClosing: true };
  it('allows the confirmed 0 -> 2 correction', () => expect(validateDoubleConsumptionRepair(valid)).toBe(2));
  it.each(['activePlacedBox','fullyPickedBeforeClosing'] as const)('blocks missing %s', key => {
    expect(() => validateDoubleConsumptionRepair({...valid,[key]:false})).toThrow();
  });
  it.each(['laterRecount','activeWork'] as const)('blocks %s', key => {
    expect(() => validateDoubleConsumptionRepair({...valid,[key]:true})).toThrow();
  });
  it.each([{physical:3},{available:1},{unprotectedMarks:1},{duplicate:0},{physical:NaN}])('blocks ambiguous quantities %j', values=>{
    expect(()=>validateDoubleConsumptionRepair({...valid,...values})).toThrow();
  });
});

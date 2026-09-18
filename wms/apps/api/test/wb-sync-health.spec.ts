import { describe, expect, it } from 'vitest';
import { evaluateWbSyncProof, nextWbHealthState } from '../src/modules/marketplace-connections/wb-sync-health.rules';
const now = new Date('2026-09-18T13:00:00Z');
const row = { runId: 'new', status: 'CONFIRMED', phase: 'CHECK', calculatedAmount: 3, observedAmount: 3, updatedAt: now };
describe('WB cycle health', () => {
  // TEST: old CHECK rows cannot turn a failed new cycle green.
  it('rejects stale, absent and mixed-run evidence', () => {
    expect(evaluateWbSyncProof([], now).success).toBe(false);
    expect(evaluateWbSyncProof([{ ...row, updatedAt: new Date(0) }], now).success).toBe(false);
    expect(evaluateWbSyncProof([row, { ...row, runId: 'another' }], now).success).toBe(false);
  });
  // TEST: a mismatched decrease stops success even if most rows match.
  it('counts mismatch and unconfirmed separately', () => {
    const result = evaluateWbSyncProof([row, { ...row, status: 'MISMATCH', observedAmount: 4 }, { ...row, status: 'UNCONFIRMED' }], now);
    expect(result).toMatchObject({ success: false, confirmed: 1, mismatch: 1, unconfirmed: 1 });
    expect(evaluateWbSyncProof([row], now).success).toBe(true);
  });
  // TEST: incident identity is stable until recovery, then next check is one hour away.
  it('deduplicates repeated failure and resumes hourly checks', () => {
    const first = nextWbHealthState({ incidentAt: null, failures: 0 }, true, now);
    const second = nextWbHealthState(first, true, new Date(now.getTime() + 60000));
    expect(second.incidentAt).toBe(first.incidentAt);
    expect(second.failures).toBe(2);
    expect(nextWbHealthState(second, false, now)).toEqual({ incidentAt: null, failures: 0, nextCheckAt: '2026-09-18T14:00:00.000Z' });
  });
});

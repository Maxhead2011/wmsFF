// FIX: a completed worker is not proof that WB accepted the stock plan.
export type WbSyncProof = { runId: string; status: string; phase: string; calculatedAmount: number; observedAmount: number | null; updatedAt: Date; error?: string | null };
export function evaluateWbSyncProof(rows: WbSyncProof[], startedAt: Date) {
  const fresh = rows.filter(row => row.updatedAt >= startedAt);
  const runs = [...new Set(fresh.map(row => row.runId))];
  const confirmed = fresh.filter(row => row.status === 'CONFIRMED' && row.observedAmount === row.calculatedAmount).length;
  const mismatch = fresh.filter(row => row.status === 'MISMATCH' || row.status === 'CONFIRMED' && row.observedAmount !== row.calculatedAmount).length;
  const unknown = fresh.filter(row => row.error?.includes('WB не вернул')).length;
  const unconfirmed = fresh.length - confirmed - mismatch;
  return { runIds: runs, confirmed, mismatch, unknown, unconfirmed,
    success: fresh.length > 0 && fresh.length === rows.length && runs.length === 1 && confirmed === fresh.length };
}

export const WB_HEALTH_HOUR = 3_600_000;
// FIX: repetitions update one incident; recovery restores the hourly cadence.
export function nextWbHealthState(previous: { incidentAt: string | null; failures: number }, problem: boolean, now: Date) {
  return { incidentAt: problem ? previous.incidentAt ?? now.toISOString() : null,
    failures: problem ? previous.failures + 1 : 0,
    nextCheckAt: new Date(now.getTime() + (problem ? 60_000 : WB_HEALTH_HOUR)).toISOString() };
}

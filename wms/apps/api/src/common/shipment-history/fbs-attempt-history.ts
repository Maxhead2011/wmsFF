import type { FbsTsdAssembly, FbsOrderRequestLink, FbsCargoPlacePacking, Prisma } from '@prisma/client';

type HistoryDb = Pick<Prisma.TransactionClient, 'fbsAssemblyAttemptHistory'> & Partial<Pick<Prisma.TransactionClient, 'fbsReshipmentRun'>>;
export type HistoricalFbsAttempt = FbsTsdAssembly & { cargoPacking: FbsCargoPlacePacking | null };

// FIX: pausing new repeats must not hide previously archived work/payroll.
export const hasFbsAttemptHistory = () => ['true', 'read-only'].includes(process.env.WMS_FBS_REPEAT_ASSEMBLY_ENABLED ?? '') ||
  ['true', 'read-only'].includes(process.env.WMS_FBS_RESHIPMENT_ENABLED ?? '');

// FIX: restoration is read-only; never write a historical snapshot to live stock.
export function restoreAttemptSnapshot(value: Prisma.JsonValue): HistoricalFbsAttempt {
  const snapshot = structuredClone(value) as unknown as HistoricalFbsAttempt;
  if (!snapshot || typeof snapshot.id !== 'string' || snapshot.status !== 'COMPLETED') {
    throw new Error('Invalid completed FBS attempt snapshot');
  }
  restoreDates(snapshot as unknown as Record<string, unknown>);
  if (snapshot.cargoPacking) restoreDates(snapshot.cargoPacking as unknown as Record<string, unknown>);
  return snapshot;
}

function restoreDates(record: Record<string, unknown>) {
  for (const key of Object.keys(record)) {
    if (key.endsWith('At') && typeof record[key] === 'string') {
      const date = new Date(record[key] as string);
      if (!Number.isFinite(date.getTime())) throw new Error(`Invalid FBS attempt date: ${key}`);
      record[key] = date;
    }
  }
}

export async function readFbsAttemptHistory(
  db: HistoryDb,
  where: Prisma.FbsAssemblyAttemptHistoryWhereInput,
) {
  // No additional queries/schema dependency in installations without this feature.
  if (!hasFbsAttemptHistory()) return [];
  const rows = await db.fbsAssemblyAttemptHistory.findMany({ where, orderBy: { completedAt: 'asc' } });
  const result = rows.map(row => ({
    task: restoreAttemptSnapshot(row.taskSnapshot),
    link: row.linkSnapshot as unknown as FbsOrderRequestLink,
    successorId: row.successorId,
  }));
  // FIX: a SAME_ITEM delivery is not another physical attempt. Its original
  // request still needs immutable composition evidence, but global work/payroll
  // queries must count only the single live (or later archived) physical task.
  const requested = typeof where.requestId === 'string' ? [where.requestId] :
    where.requestId && typeof where.requestId === 'object' && Array.isArray(where.requestId.in) ? where.requestId.in : [];
  if (requested.length && ['true','read-only'].includes(process.env.WMS_FBS_RESHIPMENT_ENABLED ?? '') &&
      Object.keys(where).every(key => ['requestId','clientId'].includes(key))) {
    if (!db.fbsReshipmentRun) throw new Error('Reshipment history storage unavailable');
    const runs = await db.fbsReshipmentRun.findMany({ where: { mode: 'SAME_ITEM', status: 'CREATED',
      sourceRequestIds: { hasSome: requested }, ...(where.clientId ? {clientId: where.clientId as Prisma.FbsReshipmentRunWhereInput['clientId']} : {}) },
      select: {snapshot:true}, orderBy: {createdAt:'asc'} });
    for (const run of runs) {
      const snapshot = run.snapshot;
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Array.isArray(snapshot.physicalEvidence)) continue;
      for (const entry of snapshot.physicalEvidence) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !entry.task || !entry.link) continue;
        const task = restoreAttemptSnapshot(entry.task);
        if (requested.includes(task.requestId) && !result.some(row => row.task.id === task.id && row.task.requestId === task.requestId)) {
          result.push({task, link: entry.link as unknown as FbsOrderRequestLink, successorId: task.id});
        }
      }
    }
  }
  return result;
}

export async function appendFbsAttemptHistory<T extends { id: string }>(
  db: HistoryDb,
  current: T[],
  where: Prisma.FbsAssemblyAttemptHistoryWhereInput,
): Promise<void> {
  const ids = new Set(current.map(row => row.id));
  const history = await readFbsAttemptHistory(db, where);
  for (const row of history) {
    if (!ids.has(row.task.id)) current.push(row.task as unknown as T);
  }
}

import type { Prisma } from '@prisma/client';

export const fboProgressStatusEnabled = () => process.env.WMS_FBO_PROGRESS_STATUS_ENABLED === 'true';
// FIX: PostgreSQL row-lock serialization/deadlock errors are wrapped as P2010.
// Both SQLSTATEs abort the transaction; timeouts/unknown outcomes must not retry here.
export function fboRetryableTransactionError(error: { code: string; meta?: Record<string, unknown> }) {
  return error.code === 'P2034' || (fboProgressStatusEnabled() && error.code === 'P2010' &&
    ['40001', '40P01'].includes(String(error.meta?.code)));
}
// FIX: compare each line, never let excess on one SKU cover a shortage on another.
export function fboProgressState(lines: Array<{ id: string; quantity: number }>, units: Array<{ requestItemId: string; state: string; quantity?: number }>) {
  const active = units.filter(u => u.state === 'PICKED' || u.state === 'PACKED');
  const counts = new Map<string, { picked: number; packed: number }>();
  for (const u of active) {
    const count = counts.get(u.requestItemId) ?? { picked: 0, packed: 0 };
    count.picked += u.quantity ?? 1; if (u.state === 'PACKED') count.packed += u.quantity ?? 1;
    counts.set(u.requestItemId, count);
  }
  const valid = lines.length > 0 && lines.every(l => Number.isInteger(l.quantity) && l.quantity > 0) &&
    [...counts.keys()].every(id => lines.some(l => l.id === id));
  return {
    started: active.length > 0,
    picked: valid && lines.every(l => counts.get(l.id)?.picked === l.quantity),
    packed: valid && lines.every(l => counts.get(l.id)?.packed === l.quantity),
  };
}

// FIX: read-only labels for an already authorized page, without one query per request.
// This never grants PACKED/shipping permissions or changes persistent lifecycle states.
export async function fboProgressLabels(db: Prisma.TransactionClient, ids: string[]) {
  const labels: Record<string, string> = {};
  if (!fboProgressStatusEnabled() || !ids.length) return labels;
  // Runtime already contains pickClosure; the historical source Prisma snapshot does not.
  const assemblies = await db.fboAssembly.findMany({ where: { requestId: { in: ids },
    request: { status: { in: ['SUBMITTED', 'APPROVED', 'IN_WORK'] } } },
    select: { requestId: true, phase: true, pickClosure: true, request: { select: { items: { select: { id: true, quantity: true } } } } } } as any) as unknown as Array<{
      requestId: string; phase: string; pickClosure: unknown; request: { items: Array<{ id: string; quantity: number }> };
    }>;
  if (!assemblies.length) return labels;
  const counts = await db.fboAssemblyUnit.groupBy({ by: ['requestId', 'requestItemId', 'state'],
    where: { requestId: { in: assemblies.map(a => a.requestId) }, state: { in: ['PICKED', 'PACKED'] } }, _count: { _all: true } });
  for (const a of assemblies) {
    const closure = a.pickClosure as { version?: number; quantities?: Record<string, number> } | null;
    let lines = a.request.items;
    if (closure) {
      const q = closure.quantities;
      if (closure.version !== 1 || !q || Array.isArray(q) || Object.keys(q).length !== lines.length ||
        lines.some(l => !Number.isSafeInteger(q[l.id]) || q[l.id] < 0 || q[l.id] > l.quantity)) continue;
      lines = lines.map(l => ({ ...l, quantity: q[l.id] })).filter(l => l.quantity > 0);
    }
    const state = fboProgressState(lines, counts.filter(c => c.requestId === a.requestId)
      .map(c => ({ requestItemId: c.requestItemId, state: c.state, quantity: c._count._all })));
    if (state.packed) labels[a.requestId] = 'Упаковано, ожидает проверки';
    else if (state.started) labels[a.requestId] = 'В работе';
  }
  return labels;
}

// FIX: caller already holds ClientRequest FOR UPDATE in the scan transaction.
// No CONTROL/COMPLETED transition: carton closure and physical control stay explicit.
export async function reconcileFboProgress(tx: Prisma.TransactionClient, requestId: string, actorId: string | null) {
  if (!fboProgressStatusEnabled()) return;
  const request = await tx.clientRequest.findUnique({ where: { id: requestId },
    select: { status: true, items: { select: { id: true, quantity: true } } } });
  if (!request || !['SUBMITTED', 'APPROVED', 'IN_WORK'].includes(request.status)) return;
  const assembly = await tx.fboAssembly.findUnique({ where: { requestId } });
  if (!assembly || !['PICKING', 'PACKING', 'CONTROL'].includes(assembly.phase)) return;
  // FIX: packing/control are already settled; do not reload every unit per scan.
  if (request.status === 'IN_WORK' && assembly.phase !== 'PICKING') return;
  const units = await tx.fboAssemblyUnit.findMany({ where: { requestId, state: { in: ['PICKED', 'PACKED'] } },
    select: { requestItemId: true, state: true } });
  const progress = fboProgressState(request.items, units);
  const statusChanged = progress.started && request.status !== 'IN_WORK';
  const phaseChanged = progress.picked && assembly.phase === 'PICKING';
  if (statusChanged) await tx.clientRequest.update({ where: { id: requestId }, data: { status: 'IN_WORK' } });
  if (phaseChanged) await tx.fboAssembly.update({ where: { requestId }, data: { phase: 'PACKING' } });
  if (statusChanged || phaseChanged) await tx.auditLog.create({ data: {
    userId: actorId, action: 'FBO_PROGRESS_RECONCILED', entity: 'ClientRequest', entityId: requestId,
    payload: { previousStatus: request.status, previousPhase: assembly.phase, statusChanged, phaseChanged },
  } });
}

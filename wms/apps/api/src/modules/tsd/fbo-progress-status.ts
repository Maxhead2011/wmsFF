import type { Prisma } from '@prisma/client';

export const fboProgressStatusEnabled = () => process.env.WMS_FBO_PROGRESS_STATUS_ENABLED === 'true';
// FIX: compare each line, never let excess on one SKU cover a shortage on another.
export function fboProgressState(lines: Array<{ id: string; quantity: number }>, units: Array<{ requestItemId: string; state: string }>) {
  const active = units.filter(u => u.state === 'PICKED' || u.state === 'PACKED');
  const counts = new Map<string, { picked: number; packed: number }>();
  for (const u of active) {
    const count = counts.get(u.requestItemId) ?? { picked: 0, packed: 0 };
    count.picked++; if (u.state === 'PACKED') count.packed++;
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

// FIX: caller already holds ClientRequest FOR UPDATE in the scan transaction.
// No CONTROL/COMPLETED transition: carton closure and physical control stay explicit.
export async function reconcileFboProgress(tx: Prisma.TransactionClient, requestId: string, actorId: string) {
  if (!fboProgressStatusEnabled()) return;
  const request = await tx.clientRequest.findUnique({ where: { id: requestId },
    select: { status: true, items: { select: { id: true, quantity: true } } } });
  if (!request || !['SUBMITTED', 'APPROVED', 'IN_WORK'].includes(request.status)) return;
  const assembly = await tx.fboAssembly.findUnique({ where: { requestId } });
  if (!assembly || !['PICKING', 'PACKING', 'CONTROL'].includes(assembly.phase)) return;
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

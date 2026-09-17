import type { PrismaService } from '../../common/prisma/prisma.service';

// FIX: a null user is not evidence of automatic creation. Only an explicit audit confirmation is.
export async function attachConfirmedRequestAuthors<T extends { id: string; createdByUserId?: string | null }>(
  db: PrismaService, requests: T[],
): Promise<Array<T & { creationAuthorLabel?: string }>> {
  const ids = requests.filter(r => r.createdByUserId === null).map(r => r.id);
  if (!ids.length) return requests;
  const evidence = await db.auditLog.findMany({
    where: { action: 'client_request.author_confirmed', entity: 'ClientRequest', entityId: { in: ids } },
    select: { entityId: true, payload: true },
  });
  const confirmed = new Set(evidence.filter(e => e.payload && typeof e.payload === 'object' &&
    !Array.isArray(e.payload) && e.payload.author === 'WMS').map(e => e.entityId));
  return requests.map(r => r.createdByUserId === null && confirmed.has(r.id)
    ? { ...r, creationAuthorLabel: 'WMS' } : r);
}

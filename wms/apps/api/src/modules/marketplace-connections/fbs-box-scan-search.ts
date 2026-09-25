import type { PrismaService } from '../../common/prisma/prisma.service';

export const boundedBoxScanEnabled = () => process.env.WMS_FBS_BOX_SCAN_BOUNDED_ENABLED === 'true';
const pending = new WeakMap<object, Map<string, Promise<unknown>>>();

// FIX: share only an in-flight, identical authenticated operation. Never cache results/errors.
export function sharePendingBoxScan<T>(owner: object, key: string, action: () => Promise<T>): Promise<T> {
  let calls = pending.get(owner);
  if (!calls) { calls = new Map(); pending.set(owner, calls); }
  const prior = calls.get(key);
  if (prior) return prior as Promise<T>;
  const promise = Promise.resolve().then(action).finally(() => {
    if (calls!.get(key) === promise) calls!.delete(key);
  });
  calls.set(key, promise);
  return promise;
}

const normalized = (value: string | null | undefined) => (value ?? '').toLocaleLowerCase('ru-RU');

type Reservation = { taskId: string; boxId: string | null; itemCount: number; releasableBackground: boolean };
// FIX: a search snapshot is scoped to one operation and invalidated after reservation changes.
// It is only a candidate hint; callers must revalidate stock inside the claim transaction.
export function boxReservationSnapshot(load: () => Promise<Map<string, Reservation[]>>) {
  let snapshot: Promise<Map<string, Reservation[]>> | undefined;
  return {
    invalidate() { snapshot = undefined; },
    async read(skuId: string, boxId: string, excludeTaskId: string | null) {
      snapshot ??= load();
      return ((await snapshot).get(skuId) ?? []).filter(row => row.boxId === boxId && row.taskId !== excludeTaskId);
    },
  };
}

// FIX: reverse article mappings narrow the search before resolving stock/reservations.
// This is a conservative candidate filter; the existing resolver still validates exact
// duplicate mappings, sizes, physical reservations and the final lease transaction.
export async function boxCandidateSkuIds(db: PrismaService, clientId: string, sourceIds: string[]): Promise<string[]> {
  const ids = new Set(sourceIds);
  if (!ids.size) return [];
  const client = await db.client.findUnique({ where: { id: clientId }, select: { relabelingEnabled: true } });
  if (!client?.relabelingEnabled) return [...ids];
  const [sources, mappings] = await Promise.all([
    db.sku.findMany({ where: { clientId, id: { in: [...ids] } },
      select: { id: true, article: true, clientSku: true, internalSku: true, size: true } }),
    db.clientArticleMapping.findMany({ where: { clientId }, select: { sourceArticle: true, targetArticle: true } }),
  ]);
  const relevant = mappings.filter(mapping => sources.some(source => {
    const article = normalized(mapping.sourceArticle);
    return [source.article, source.clientSku, source.internalSku].some(value => normalized(value) === article) ||
      normalized(source.internalSku).startsWith(article + '-');
  }));
  if (!relevant.length) return [...ids];
  const articles = [...new Set(relevant.map(mapping => mapping.targetArticle))];
  const targets = await db.sku.findMany({ where: { clientId, OR: articles.flatMap(article => [
    { article: { equals: article, mode: 'insensitive' as const } },
    { clientSku: { equals: article, mode: 'insensitive' as const } },
  ]) }, select: { id: true, article: true, clientSku: true, size: true } });
  for (const target of targets) {
    if (relevant.some(mapping => [target.article, target.clientSku].some(value => normalized(value) === normalized(mapping.targetArticle)) &&
      sources.some(source => {
        const article = normalized(mapping.sourceArticle);
        return (!target.size || normalized(source.size) === normalized(target.size)) &&
          ([source.article, source.clientSku, source.internalSku].some(value => normalized(value) === article) || normalized(source.internalSku).startsWith(article + '-'));
      }))) ids.add(target.id);
  }
  return [...ids];
}

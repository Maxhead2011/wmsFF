import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';

export function needsDisableVerification(enabled: boolean) {
  return !enabled && process.env.WMS_WB_URGENT_STOCK_SYNC === 'true';
}

// FIX: persist the operator decision and its retry together, including repeated OFF.
export async function saveWbPublicationChoices<T>(
  db: PrismaService, writes: Prisma.PrismaPromise<T>[], clientId: string, skuIds: string[],
  enabled: boolean, bulk: boolean,
): Promise<T[]> {
  if (!needsDisableVerification(enabled)) return bulk ? db.$transaction(writes) : [await writes[0]];
  const event = db.$executeRaw`INSERT INTO "WbStockSyncEvent" ("clientId","skuIds","allSkus")
    VALUES (${clientId}, ${skuIds}::text[], false)`;
  const results = await db.$transaction([...writes, event]);
  return results.slice(0, writes.length) as T[];
}

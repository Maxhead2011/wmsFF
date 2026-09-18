import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

// FIX: enable only for our deployment; no cache survives a calculation or a client change.
export const fbsCalculationFastEnabled = () => process.env.WMS_FBS_CALCULATION_FAST_ENABLED === 'true';

const requestSelect = {
  id: true, number: true, title: true, status: true, warehouseId: true,
  fbsEmergencyAssemblyAt: true, fbsEmergencyAssemblyByUserId: true, fbsEmergencyAssemblyByName: true,
} satisfies Prisma.ClientRequestSelect;

// FIX: Prisma's include hydrated the same request thousands of times per order batch.
// Keep the exact caller-supplied statuses and connection/order pairs, then hydrate unique requests.
export async function readFbsCalculationLinks(
  db: Pick<PrismaService, '$queryRaw' | 'clientRequest'>,
  clientId: string,
  orderIdsByConnection: ReadonlyMap<string, string[]>,
  syncStatuses: string[],
) {
  const linkSelect = { marketplace: true, connectionId: true, orderId: true, requestId: true, syncStatus: true } as const;
  const links: Prisma.FbsOrderRequestLinkGetPayload<{ select: typeof linkSelect }>[] = [];
  for (const [connectionId, values] of orderIdsByConnection) {
    const ids = [...new Set(values.map(value => value.trim()).filter(Boolean))];
    // FIX: bind one array, not thousands of independent IN parameters. Reused plans
    // for the latter became slower after PostgreSQL's first five executions.
    for (let offset = 0; offset < ids.length; offset += 10000) {
      links.push(...await db.$queryRaw<typeof links>(Prisma.sql`
        SELECT "marketplace", "connectionId", "orderId", "requestId", "syncStatus"
        FROM "FbsOrderRequestLink"
        WHERE "clientId" = ${clientId} AND "connectionId" = ${connectionId}
          AND "orderId" = ANY(${ids.slice(offset, offset + 10000)}::text[])
          AND "syncStatus" = ANY(${syncStatuses}::text[])
      `));
    }
  }
  const ids = [...new Set(links.map(link => link.requestId))];
  const requests = new Map<string, Prisma.ClientRequestGetPayload<{ select: typeof requestSelect }>>();
  for (let offset = 0; offset < ids.length; offset += 5000) {
    const rows = await db.clientRequest.findMany({
      where: { clientId, id: { in: ids.slice(offset, offset + 5000) } }, select: requestSelect,
    });
    for (const row of rows) requests.set(row.id, row);
  }
  // A request deleted between reads cannot provide a current route or assembly assignment.
  return links.flatMap(link => {
    const request = requests.get(link.requestId);
    return request ? [{ ...link, request }] : [];
  });
}

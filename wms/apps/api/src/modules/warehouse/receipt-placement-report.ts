import { Prisma } from "@prisma/client";

// FIX: scope stock, pallet placements and receipt membership to the same warehouse and client.
export async function receiptPlacementReport(
  db: any,
  warehouseId: string,
  clientIds?: string[],
  cursor?: string,
  summaryOnly = false,
) {
  const eligible = placementStockSql(warehouseId, clientIds);
  return db.$transaction(
    async (tx: any) => {
      const [summary] = await tx.$queryRaw(Prisma.sql`${eligible}
      SELECT count(*)::int AS boxes,count(*) FILTER(WHERE NOT placed AND "needsPlacement")::int AS awaiting,
      (SELECT count(*)::int FROM "StoragePallet" s WHERE s."warehouseId"=${warehouseId}
        AND s.status<>'deleted' AND EXISTS(SELECT 1 FROM stocked b JOIN "StoragePalletBox" p
          ON p."palletId"=s.id AND (p."boxId"=b.id OR (p."boxId" IS NULL AND p."boxCode"=b.code))
          WHERE b."clientId"=s."clientId")) AS pallets FROM stocked`);
      if (summaryOnly) return { summary, items: [], nextCursor: null };
      const items = await tx.$queryRaw(Prisma.sql`${eligible}
      SELECT b.id,b.code,b."clientId",b.client,
        CASE WHEN m.value->>'clientId'=b."clientId" AND m.value->>'warehouseId'=${warehouseId}
          THEN m.value->>'series'
          WHEN i."receiptAt" IS NOT NULL THEN 'SERIES:'||extract(year from i."receiptAt")::int||':'||regexp_replace(b.code,'_[0-9]+$','')
          ELSE NULL END AS receipt,
        i."receiptAt" AS "receiptAt"
      FROM stocked b
      LEFT JOIN "ReceiptStockIdentity" i ON i."boxId"=b.id
      LEFT JOIN "SystemSetting" m ON m.key='receipt.membership.v1:'||b."clientId"||':'||b.id
      WHERE NOT b.placed AND b."needsPlacement" ${cursor ? Prisma.sql`AND b.id>${cursor}` : Prisma.empty}
      ORDER BY b.id LIMIT 201`);
      return {
        summary,
        items: items.slice(0, 200),
        nextCursor: items.length > 200 ? items[199].id : null,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export function placementStockSql(warehouseId: string, clientIds?: string[]) {
  const scope = clientIds
    ? clientIds.length
      ? Prisma.sql`AND b."clientId" IN (${Prisma.join(clientIds)})`
      : Prisma.sql`AND FALSE`
    : Prisma.empty;
  return Prisma.sql`WITH stocked AS (
    SELECT b.id,b.code,b.status,b."clientId",c.name AS client,
      (c."stockBalanceMode"='PALLET_SORT' AND NOT c."storesWithoutBoxes"
        AND EXISTS(SELECT 1 FROM "StockBalance" a WHERE a."boxId"=b.id AND a."warehouseId"=${warehouseId}
          AND a."clientId"=b."clientId" AND a.quantity>0 AND a.status NOT IN ('SHIPPING','PACKING','IN_TRANSIT'))) AS "needsPlacement",
      EXISTS(SELECT 1 FROM "StoragePalletBox" p JOIN "StoragePallet" s ON s.id=p."palletId"
        WHERE s."warehouseId"=${warehouseId} AND s."clientId"=b."clientId" AND s.status<>'deleted'
        AND (p."boxId"=b.id OR (p."boxId" IS NULL AND p."boxCode"=b.code))) AS placed
    FROM "Box" b JOIN "Client" c ON c.id=b."clientId"
    WHERE b."warehouseId"=${warehouseId} AND b.status NOT IN ('deleted','archived') ${scope}
      AND EXISTS(SELECT 1 FROM "StockBalance" q WHERE q."boxId"=b.id AND q."warehouseId"=${warehouseId}
        AND q."clientId"=b."clientId" AND q.quantity>0 AND q.status<>'IN_TRANSIT')
  )`;
}

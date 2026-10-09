import { Prisma } from '@prisma/client';

// FIX: report-only aggregation. Operational approval/scan paths keep their locks and reads.
export async function receiptReportEvidence(db:Prisma.TransactionClient,clientId:string,warehouseId:string) {
  const movements=await db.$queryRaw<Array<{boxId:string;sourceDocument:string|null;createdAt:Date;quantity:number}>>(Prisma.sql`
    SELECT "boxId", "sourceDocument", MAX("createdAt") AS "createdAt", SUM(quantity)::integer AS quantity
    FROM "StockMovement" WHERE "clientId"=${clientId} AND "warehouseId"=${warehouseId}
      AND type='RECEIPT' AND quantity>0 AND "boxId" IS NOT NULL
    GROUP BY "boxId", "sourceDocument", EXTRACT(YEAR FROM "createdAt" AT TIME ZONE 'UTC')
    ORDER BY MAX("createdAt") DESC`);
  const openings=await db.$queryRaw<Array<{payload:Prisma.JsonValue;createdAt:Date;operationType:string}>>(Prisma.sql`
    SELECT payload,"createdAt","operationType" FROM (
      SELECT DISTINCT ON (payload->>'boxCode') jsonb_build_object('boxCode',payload->'boxCode','sourceDocument',payload->'sourceDocument') AS payload,
        "createdAt","operationType"
      FROM "TsdOperation" WHERE "operationType" IN ('receipt_open_box','receipt_box_status') AND status='ACCEPTED'
        AND payload->'clientId'=to_jsonb(${clientId}::text) AND payload->'warehouseId'=to_jsonb(${warehouseId}::text)
        AND jsonb_typeof(payload->'sourceDocument')='string' AND payload->>'sourceDocument'<>''
      ORDER BY payload->>'boxCode', "createdAt" DESC
    ) AS latest ORDER BY "createdAt" DESC`);
  return {movements,openings};
}

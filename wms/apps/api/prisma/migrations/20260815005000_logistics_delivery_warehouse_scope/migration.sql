ALTER TABLE "LogisticsDeliveryRequest" ADD COLUMN "warehouseId" TEXT;

UPDATE "LogisticsDeliveryRequest" delivery
SET "warehouseId" = request."warehouseId"
FROM "ClientRequest" request
WHERE delivery."requestId" = request."id"
  AND request."warehouseId" IS NOT NULL;

WITH "single_client_scope" AS (
  SELECT
    link."clientId",
    MIN(link."warehouseId") AS "warehouseId"
  FROM "WarehouseClient" link
  JOIN "Warehouse" warehouse ON warehouse."id" = link."warehouseId"
  WHERE link."status" = 'ACTIVE'
    AND warehouse."isActive" = TRUE
  GROUP BY link."clientId"
  HAVING COUNT(DISTINCT link."warehouseId") = 1
)
UPDATE "LogisticsDeliveryRequest" delivery
SET "warehouseId" = scope."warehouseId"
FROM "single_client_scope" scope
WHERE delivery."warehouseId" IS NULL
  AND delivery."clientId" = scope."clientId";

CREATE INDEX "LogisticsDeliveryRequest_warehouseId_status_createdAt_idx"
  ON "LogisticsDeliveryRequest"("warehouseId", "status", "createdAt");

ALTER TABLE "LogisticsDeliveryRequest"
  ADD CONSTRAINT "LogisticsDeliveryRequest_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

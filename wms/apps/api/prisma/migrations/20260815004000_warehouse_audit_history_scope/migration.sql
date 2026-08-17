ALTER TABLE "WarehouseBoxCheck" ADD COLUMN "warehouseId" TEXT;
ALTER TABLE "WarehouseBoxCheckRow" ADD COLUMN "warehouseId" TEXT;
ALTER TABLE "ShippedKizHistory" ADD COLUMN "warehouseId" TEXT;

-- Historical boxes may already have moved to another branch. Backfill a check row only
-- when the row's client currently has exactly one active branch; otherwise leave it NULL
-- so branch-scoped readers fail closed instead of exposing an old check to the wrong branch.
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
UPDATE "WarehouseBoxCheckRow" row
SET "warehouseId" = scope."warehouseId"
FROM "single_client_scope" scope
WHERE row."clientId" = scope."clientId";

WITH "single_check_scope" AS (
  SELECT
    row."checkId",
    MIN(row."warehouseId") AS "warehouseId"
  FROM "WarehouseBoxCheckRow" row
  GROUP BY row."checkId"
  HAVING COUNT(*) FILTER (WHERE row."warehouseId" IS NULL) = 0
     AND COUNT(DISTINCT row."warehouseId") = 1
)
UPDATE "WarehouseBoxCheck" check_record
SET "warehouseId" = scope."warehouseId"
FROM "single_check_scope" scope
WHERE check_record."id" = scope."checkId";

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
UPDATE "WarehouseBoxCheck" check_record
SET "warehouseId" = scope."warehouseId"
FROM "single_client_scope" scope
WHERE check_record."warehouseId" IS NULL
  AND check_record."clientId" = scope."clientId";

-- A request warehouse is authoritative for shipment history.
UPDATE "ShippedKizHistory" history
SET "warehouseId" = request."warehouseId"
FROM "ClientRequest" request
WHERE history."requestId" = request."id"
  AND request."warehouseId" IS NOT NULL;

-- Legacy requests can still be assigned safely when every physical SHIP movement for
-- that request points to the same warehouse. Ambiguous requests remain unscoped.
WITH "single_ship_scope" AS (
  SELECT
    movement."sourceDocument" AS "requestId",
    MIN(movement."warehouseId") AS "warehouseId"
  FROM "StockMovement" movement
  WHERE movement."sourceDocument" IS NOT NULL
    AND movement."type" = 'SHIP'
    AND movement."quantity" < 0
    AND movement."warehouseId" IS NOT NULL
  GROUP BY movement."sourceDocument"
  HAVING COUNT(DISTINCT movement."warehouseId") = 1
)
UPDATE "ShippedKizHistory" history
SET "warehouseId" = scope."warehouseId"
FROM "single_ship_scope" scope
WHERE history."warehouseId" IS NULL
  AND history."requestId" = scope."requestId";

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
UPDATE "ShippedKizHistory" history
SET "warehouseId" = scope."warehouseId"
FROM "single_client_scope" scope
WHERE history."warehouseId" IS NULL
  AND history."clientId" = scope."clientId";

CREATE INDEX "WarehouseBoxCheck_warehouseId_createdAt_idx"
  ON "WarehouseBoxCheck"("warehouseId", "createdAt");
CREATE INDEX "WarehouseBoxCheckRow_warehouseId_decision_createdAt_idx"
  ON "WarehouseBoxCheckRow"("warehouseId", "decision", "createdAt");
CREATE INDEX "ShippedKizHistory_warehouseId_shippedAt_idx"
  ON "ShippedKizHistory"("warehouseId", "shippedAt");

ALTER TABLE "WarehouseBoxCheck"
  ADD CONSTRAINT "WarehouseBoxCheck_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WarehouseBoxCheckRow"
  ADD CONSTRAINT "WarehouseBoxCheckRow_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShippedKizHistory"
  ADD CONSTRAINT "ShippedKizHistory_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD COLUMN "warehouseId" TEXT;

-- Legacy boxes created before branches existed belong to a warehouse only
-- when the client has exactly one active branch. Ambiguous boxes stay
-- unassigned for manual review instead of being moved to a guessed city.
WITH single_active_warehouse AS (
  SELECT "clientId", MIN("warehouseId") AS "warehouseId"
  FROM "WarehouseClient"
  WHERE "status" = 'ACTIVE'
  GROUP BY "clientId"
  HAVING COUNT(*) = 1
)
UPDATE "Box" AS box
SET "warehouseId" = link."warehouseId"
FROM single_active_warehouse AS link
WHERE box."clientId" = link."clientId"
  AND box."warehouseId" IS NULL;

-- A request keeps the warehouse where the operation happened even if its box
-- or pallet was moved to another branch later. It is therefore the strongest
-- safe source for historical movement attribution.
UPDATE "StockMovement" AS movement
SET "warehouseId" = request."warehouseId"
FROM "ClientRequest" AS request
WHERE movement."sourceDocument" = request."id"
  AND movement."warehouseId" IS NULL
  AND request."warehouseId" IS NOT NULL;

-- Remaining historical movements are safe to attribute only while the client
-- has one active warehouse. Current Box/Pallet placement is intentionally not
-- used here: physical locations can move after a movement was recorded.
-- Multi-branch history remains NULL and is hidden from branch-scoped readers.
WITH single_active_warehouse AS (
  SELECT link."clientId", MIN(link."warehouseId") AS "warehouseId"
  FROM "WarehouseClient" AS link
  JOIN "Warehouse" AS warehouse ON warehouse."id" = link."warehouseId"
  WHERE link."status" = 'ACTIVE'
    AND warehouse."isActive" = TRUE
  GROUP BY link."clientId"
  HAVING COUNT(DISTINCT link."warehouseId") = 1
)
UPDATE "StockMovement" AS movement
SET "warehouseId" = link."warehouseId"
FROM single_active_warehouse AS link
WHERE movement."clientId" = link."clientId"
  AND movement."warehouseId" IS NULL;

CREATE INDEX "StockMovement_warehouseId_createdAt_idx"
  ON "StockMovement"("warehouseId", "createdAt");

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "set_stock_movement_warehouse_id"()
RETURNS trigger AS $$
BEGIN
  IF NEW."warehouseId" IS NULL AND NEW."boxId" IS NOT NULL THEN
    SELECT box."warehouseId"
      INTO NEW."warehouseId"
      FROM "Box" AS box
      WHERE box."id" = NEW."boxId";
  END IF;

  IF NEW."warehouseId" IS NULL AND NEW."palletId" IS NOT NULL THEN
    SELECT zone."warehouseId"
      INTO NEW."warehouseId"
      FROM "Pallet" AS pallet
      JOIN "Zone" AS zone ON zone."id" = pallet."zoneId"
      WHERE pallet."id" = NEW."palletId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockMovement_set_warehouse_id"
BEFORE INSERT ON "StockMovement"
FOR EACH ROW
EXECUTE FUNCTION "set_stock_movement_warehouse_id"();

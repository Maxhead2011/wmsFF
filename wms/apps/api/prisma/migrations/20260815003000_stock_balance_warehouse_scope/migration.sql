BEGIN;

ALTER TABLE "StockBalance" ADD COLUMN "warehouseId" TEXT;

-- A box is the strongest source of truth for the current branch.
UPDATE "StockBalance" AS balance
SET "warehouseId" = box."warehouseId"
FROM "Box" AS box
WHERE balance."boxId" = box."id"
  AND balance."warehouseId" IS NULL
  AND box."warehouseId" IS NOT NULL;

-- Legacy pallet-only balances inherit the warehouse through the pallet zone.
UPDATE "StockBalance" AS balance
SET "warehouseId" = zone."warehouseId"
FROM "Pallet" AS pallet
JOIN "Zone" AS zone ON zone."id" = pallet."zoneId"
WHERE balance."palletId" = pallet."id"
  AND balance."warehouseId" IS NULL;

-- A boxless balance can be assigned safely only when the client has exactly
-- one active branch. Ambiguous legacy rows deliberately remain unscoped.
WITH single_active_warehouse AS (
  SELECT "clientId", MIN("warehouseId") AS "warehouseId"
  FROM "WarehouseClient"
  WHERE "status" = 'ACTIVE'
  GROUP BY "clientId"
  HAVING COUNT(*) = 1
)
UPDATE "StockBalance" AS balance
SET "warehouseId" = link."warehouseId"
FROM single_active_warehouse AS link
WHERE balance."clientId" = link."clientId"
  AND balance."boxId" IS NULL
  AND balance."palletId" IS NULL
  AND balance."warehouseId" IS NULL;

-- Boxless identity must contain the branch. Build the complete rewrite map
-- first, so a partially deployed/new writer cannot make this migration fail on
-- an existing canonical key. Compatible duplicates are merged; a collision
-- with a different logical balance aborts the migration before data changes.
CREATE TEMP TABLE "_StockBalanceWarehouseKeyRewrite" (
  "sourceId" TEXT PRIMARY KEY,
  "targetKey" TEXT NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE "_StockBalanceWarehouseKeyMerge" (
  "targetKey" TEXT PRIMARY KEY,
  "survivorId" TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO "_StockBalanceWarehouseKeyRewrite" ("sourceId", "targetKey")
SELECT
  balance."id",
  (
    CASE
      WHEN balance."balanceKey" ~ ':warehouse:[^:]+$'
        THEN regexp_replace(balance."balanceKey", ':warehouse:[^:]+$', '')
      ELSE balance."balanceKey"
    END
  ) || ':warehouse:' || balance."warehouseId"
FROM "StockBalance" AS balance
WHERE balance."boxId" IS NULL
  AND balance."palletId" IS NULL
  AND balance."warehouseId" IS NOT NULL
  AND right(
    balance."balanceKey",
    length(':warehouse:' || balance."warehouseId")
  ) <> ':warehouse:' || balance."warehouseId";

DO $$
BEGIN
  -- More than one stale source key may canonicalize to the same target key.
  -- They are safe to merge only when every identity dimension agrees.
  IF EXISTS (
    SELECT 1
    FROM "_StockBalanceWarehouseKeyRewrite" AS left_rewrite
    JOIN "_StockBalanceWarehouseKeyRewrite" AS right_rewrite
      ON right_rewrite."targetKey" = left_rewrite."targetKey"
     AND right_rewrite."sourceId" > left_rewrite."sourceId"
    JOIN "StockBalance" AS left_source
      ON left_source."id" = left_rewrite."sourceId"
    JOIN "StockBalance" AS right_source
      ON right_source."id" = right_rewrite."sourceId"
    WHERE right_source."clientId" IS DISTINCT FROM left_source."clientId"
       OR right_source."skuId" IS DISTINCT FROM left_source."skuId"
       OR right_source."boxId" IS DISTINCT FROM left_source."boxId"
       OR right_source."palletId" IS DISTINCT FROM left_source."palletId"
       OR right_source."status" IS DISTINCT FROM left_source."status"
       OR right_source."warehouseId" IS DISTINCT FROM left_source."warehouseId"
  ) THEN
    RAISE EXCEPTION
      'StockBalance warehouse-key collision has incompatible legacy rows; reconcile data before migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "_StockBalanceWarehouseKeyRewrite" AS rewrite
    JOIN "StockBalance" AS source ON source."id" = rewrite."sourceId"
    JOIN "StockBalance" AS target
      ON target."balanceKey" = rewrite."targetKey"
     AND target."id" <> source."id"
    WHERE target."clientId" IS DISTINCT FROM source."clientId"
       OR target."skuId" IS DISTINCT FROM source."skuId"
       OR target."boxId" IS DISTINCT FROM source."boxId"
       OR target."palletId" IS DISTINCT FROM source."palletId"
       OR target."status" IS DISTINCT FROM source."status"
       OR (
         target."warehouseId" IS NOT NULL
         AND target."warehouseId" IS DISTINCT FROM source."warehouseId"
       )
  ) THEN
    RAISE EXCEPTION
      'StockBalance warehouse-key collision has incompatible rows; reconcile data before migration';
  END IF;
END;
$$;

-- Prefer an already canonical target row. Otherwise keep the lexicographically
-- first legacy row. This makes the merge deterministic and prevents a unique
-- violation when several stale keys map to a target that did not exist yet.
INSERT INTO "_StockBalanceWarehouseKeyMerge" ("targetKey", "survivorId")
SELECT
  rewrite."targetKey",
  COALESCE(
    MIN(target."id") FILTER (WHERE target."balanceKey" = rewrite."targetKey"),
    MIN(rewrite."sourceId")
  )
FROM "_StockBalanceWarehouseKeyRewrite" AS rewrite
LEFT JOIN "StockBalance" AS target
  ON target."balanceKey" = rewrite."targetKey"
GROUP BY rewrite."targetKey";

WITH merge_members AS (
  SELECT rewrite."targetKey", rewrite."sourceId" AS "memberId"
  FROM "_StockBalanceWarehouseKeyRewrite" AS rewrite
  UNION
  SELECT merge."targetKey", merge."survivorId" AS "memberId"
  FROM "_StockBalanceWarehouseKeyMerge" AS merge
), merge_totals AS (
  SELECT
    members."targetKey",
    merge."survivorId",
    SUM(balance."quantity")::INTEGER AS "quantity",
    MAX(balance."warehouseId") AS "warehouseId",
    MAX(balance."updatedAt") AS "updatedAt"
  FROM merge_members AS members
  JOIN "_StockBalanceWarehouseKeyMerge" AS merge
    ON merge."targetKey" = members."targetKey"
  JOIN "StockBalance" AS balance
    ON balance."id" = members."memberId"
  GROUP BY members."targetKey", merge."survivorId"
)
UPDATE "StockBalance" AS survivor
SET
  "quantity" = totals."quantity",
  "warehouseId" = totals."warehouseId",
  "updatedAt" = totals."updatedAt"
FROM merge_totals AS totals
WHERE survivor."id" = totals."survivorId";

DELETE FROM "StockBalance" AS source
USING "_StockBalanceWarehouseKeyRewrite" AS rewrite,
      "_StockBalanceWarehouseKeyMerge" AS merge
WHERE source."id" = rewrite."sourceId"
  AND merge."targetKey" = rewrite."targetKey"
  AND source."id" <> merge."survivorId";

UPDATE "StockBalance" AS survivor
SET "balanceKey" = merge."targetKey"
FROM "_StockBalanceWarehouseKeyMerge" AS merge
WHERE survivor."id" = merge."survivorId"
  AND survivor."balanceKey" IS DISTINCT FROM merge."targetKey";

CREATE INDEX "StockBalance_warehouseId_clientId_skuId_status_idx"
  ON "StockBalance"("warehouseId", "clientId", "skuId", "status");

ALTER TABLE "StockBalance"
  ADD CONSTRAINT "StockBalance_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Physical locations are authoritative for legacy writers. Boxless flows must
-- still pass warehouseId explicitly when more than one branch exists.
CREATE OR REPLACE FUNCTION "set_stock_balance_warehouse_id"()
RETURNS trigger AS $$
DECLARE
  canonical_base_key TEXT;
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

  IF NEW."warehouseId" IS NULL
     AND NEW."boxId" IS NULL
     AND NEW."palletId" IS NULL THEN
    SELECT MIN(link."warehouseId")
      INTO NEW."warehouseId"
      FROM "WarehouseClient" AS link
      WHERE link."clientId" = NEW."clientId"
        AND link."status" = 'ACTIVE'
      HAVING COUNT(*) = 1;
  END IF;

  IF NEW."boxId" IS NULL AND NEW."palletId" IS NULL THEN
    IF NEW."warehouseId" IS NULL THEN
      RAISE EXCEPTION
        'Boxless StockBalance requires an explicit, unambiguous warehouseId'
        USING ERRCODE = '23514';
    END IF;

    canonical_base_key := CASE
      WHEN NEW."balanceKey" ~ ':warehouse:[^:]+$'
        THEN regexp_replace(NEW."balanceKey", ':warehouse:[^:]+$', '')
      ELSE NEW."balanceKey"
    END;
    NEW."balanceKey" := canonical_base_key || ':warehouse:' || NEW."warehouseId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockBalance_set_warehouse_id"
BEFORE INSERT ON "StockBalance"
FOR EACH ROW
EXECUTE FUNCTION "set_stock_balance_warehouse_id"();

COMMIT;

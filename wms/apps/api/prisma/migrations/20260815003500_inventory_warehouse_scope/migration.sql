ALTER TABLE "InventorySession" ADD COLUMN "warehouseId" TEXT;
ALTER TABLE "InventoryBoxRescanRequest" ADD COLUMN "warehouseId" TEXT;

-- A legacy session is safe to bind only when every audited physical box with a
-- known location belongs to exactly one warehouse and no audited box is
-- unscoped. Ambiguous sessions intentionally remain NULL and are invisible to
-- branch-scoped users until an administrator resolves them.
WITH "session_box_scope" AS (
  SELECT
    audit."sessionId",
    MIN(box."warehouseId") AS "warehouseId"
  FROM "InventoryAuditBox" audit
  JOIN "Box" box ON box."id" = audit."boxId"
  GROUP BY audit."sessionId"
  HAVING COUNT(*) FILTER (WHERE box."warehouseId" IS NULL) = 0
     AND COUNT(DISTINCT box."warehouseId") = 1
)
UPDATE "InventorySession" session
SET "warehouseId" = scope."warehouseId"
FROM "session_box_scope" scope
WHERE session."id" = scope."sessionId";

-- Empty legacy client sessions can be bound only when the client has one
-- unambiguous active branch. Multi-branch sessions remain fail-closed.
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
UPDATE "InventorySession" session
SET "warehouseId" = scope."warehouseId"
FROM "single_client_scope" scope
WHERE session."warehouseId" IS NULL
  AND session."clientId" = scope."clientId";

UPDATE "InventoryBoxRescanRequest" request
SET "warehouseId" = box."warehouseId"
FROM "Box" box
WHERE box."id" = request."boxId"
  AND box."warehouseId" IS NOT NULL;

UPDATE "InventoryBoxRescanRequest" request
SET "warehouseId" = session."warehouseId"
FROM "InventorySession" session
WHERE request."warehouseId" IS NULL
  AND session."id" = request."sessionId"
  AND session."warehouseId" IS NOT NULL;

CREATE INDEX "InventorySession_warehouseId_status_createdAt_idx"
  ON "InventorySession"("warehouseId", "status", "createdAt");
CREATE INDEX "InventoryBoxRescanRequest_warehouseId_status_createdAt_idx"
  ON "InventoryBoxRescanRequest"("warehouseId", "status", "createdAt");

ALTER TABLE "InventorySession"
  ADD CONSTRAINT "InventorySession_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryBoxRescanRequest"
  ADD CONSTRAINT "InventoryBoxRescanRequest_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

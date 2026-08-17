ALTER TABLE "BillingInvoice" ADD COLUMN "warehouseId" TEXT;

UPDATE "BillingInvoice" AS invoice
SET "warehouseId" = request."warehouseId"
FROM "ClientRequest" AS request
WHERE invoice."requestId" = request."id"
  AND invoice."warehouseId" IS NULL;

-- Legacy manual invoices can be attributed safely only when the client belongs
-- to exactly one active branch. Ambiguous multi-branch invoices remain global
-- and are intentionally hidden from branch managers.
UPDATE "BillingInvoice" AS invoice
SET "warehouseId" = branch."warehouseId"
FROM (
  SELECT "clientId", MIN("warehouseId") AS "warehouseId"
  FROM "WarehouseClient"
  WHERE "status" = 'ACTIVE'
  GROUP BY "clientId"
  HAVING COUNT(*) = 1
) AS branch
WHERE invoice."clientId" = branch."clientId"
  AND invoice."warehouseId" IS NULL;

CREATE INDEX "BillingInvoice_warehouseId_periodFrom_idx"
  ON "BillingInvoice"("warehouseId", "periodFrom");

ALTER TABLE "BillingInvoice"
  ADD CONSTRAINT "BillingInvoice_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

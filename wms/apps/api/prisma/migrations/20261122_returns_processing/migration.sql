CREATE TABLE "ReturnBatch" (
 "id" TEXT PRIMARY KEY, "clientId" TEXT NOT NULL REFERENCES "Client"("id"),
 "warehouseId" TEXT NOT NULL REFERENCES "Warehouse"("id"), "status" TEXT NOT NULL DEFAULT 'SORTING',
 "createdById" TEXT NOT NULL REFERENCES "User"("id"), "createdByName" TEXT NOT NULL,
 "completedById" TEXT REFERENCES "User"("id"), "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ReturnBatch_status_check" CHECK ("status" IN ('SORTING','STORED'))
);
CREATE INDEX "ReturnBatch_warehouseId_clientId_createdAt_idx" ON "ReturnBatch"("warehouseId","clientId","createdAt");
CREATE TABLE "ReturnUnit" (
 "id" TEXT PRIMARY KEY, "batchId" TEXT NOT NULL REFERENCES "ReturnBatch"("id") ON DELETE RESTRICT,
 "clientId" TEXT NOT NULL REFERENCES "Client"("id"), "marketplace" TEXT NOT NULL,
 "returnCode" TEXT NOT NULL, "barcode" TEXT NOT NULL, "skuId" TEXT NOT NULL REFERENCES "Sku"("id"),
 "productName" TEXT NOT NULL, "condition" TEXT NOT NULL, "boxId" TEXT NOT NULL REFERENCES "Box"("id"), "boxCode" TEXT NOT NULL,
 "scannedById" TEXT NOT NULL REFERENCES "User"("id"), "scannedByName" TEXT NOT NULL,
 "receivedAt" TIMESTAMP(3), "releasedAt" TIMESTAMP(3), "kiz" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ReturnUnit_marketplace_check" CHECK ("marketplace" IN ('WILDBERRIES','OZON')),
 CONSTRAINT "ReturnUnit_condition_check" CHECK ("condition" IN ('NORMAL','INCOMPLETE','DAMAGED','WRONG_ITEM'))
);
CREATE UNIQUE INDEX "ReturnUnit_clientId_marketplace_returnCode_barcode_key" ON "ReturnUnit"("clientId","marketplace","returnCode","barcode");
CREATE INDEX "ReturnUnit_batchId_boxId_idx" ON "ReturnUnit"("batchId","boxId");

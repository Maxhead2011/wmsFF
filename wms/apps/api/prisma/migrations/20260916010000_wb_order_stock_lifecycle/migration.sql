-- FIX: additive, dormant until this installation enables the lifecycle flag.
ALTER TABLE "FbsTsdAssembly" ADD COLUMN "stockWarehouseId" TEXT;
UPDATE "FbsTsdAssembly" t SET "stockWarehouseId" = r."warehouseId"
FROM "ClientRequest" r WHERE r.id=t."requestId" AND r."warehouseId" IS NOT NULL;
UPDATE "FbsTsdAssembly" t SET "stockWarehouseId" = b."warehouseId"
FROM "Box" b WHERE b.id=COALESCE(t."boxId",t."reservedBoxId") AND t."stockWarehouseId" IS NULL;
CREATE TABLE "WbOrderShipment" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "connectionId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL, "assemblyId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL, "skuId" TEXT NOT NULL, "quantity" INTEGER NOT NULL,
  "kiz" TEXT, "source" TEXT NOT NULL, "shippedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "orderSnapshot" JSONB NOT NULL, "assemblySnapshot" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "WbOrderShipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WbOrderShipment_quantity_check" CHECK ("quantity" > 0)
);
CREATE UNIQUE INDEX "WbOrderShipment_assemblyId_key" ON "WbOrderShipment"("assemblyId");
CREATE INDEX "WbOrderShipment_clientId_connectionId_orderId_idx" ON "WbOrderShipment"("clientId", "connectionId", "orderId");
CREATE INDEX "WbOrderShipment_clientId_warehouseId_shippedAt_idx" ON "WbOrderShipment"("clientId", "warehouseId", "shippedAt");
CREATE INDEX "WbOrderShipment_requestId_idx" ON "WbOrderShipment"("requestId");

-- FIX: additive reporting-only cache; no stock or order history is changed.
CREATE TABLE "OperationsStatisticsFact" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "marketplace" "MarketplaceType" NOT NULL,
  "connectionId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderPlacedAt" TIMESTAMP(3),
  "sellerWarehouseId" TEXT,
  "supplyId" TEXT,
  "supplyScannedAt" TIMESTAMP(3),
  "supplierStatus" TEXT,
  "wbStatus" TEXT,
  "requiresReshipment" BOOLEAN,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "issue" TEXT,
  CONSTRAINT "OperationsStatisticsFact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OperationsStatisticsFact_marketplace_connectionId_orderId_key" ON "OperationsStatisticsFact"("marketplace", "connectionId", "orderId");
CREATE INDEX "OperationsStatisticsFact_clientId_orderPlacedAt_idx" ON "OperationsStatisticsFact"("clientId", "orderPlacedAt");

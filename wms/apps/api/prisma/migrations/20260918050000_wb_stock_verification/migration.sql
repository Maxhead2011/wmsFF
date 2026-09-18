CREATE TABLE "WbStockPublicationCheck" (
 "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "connectionId" TEXT NOT NULL,
 "warehouseId" TEXT NOT NULL, "skuId" TEXT, "chrtId" INTEGER NOT NULL, "phase" TEXT NOT NULL,
 "calculatedAmount" INTEGER NOT NULL, "sentAmount" INTEGER, "observedAmount" INTEGER,
 "status" TEXT NOT NULL DEFAULT 'PLANNED', "sentAt" TIMESTAMP(3), "checkedAt" TIMESTAMP(3), "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "WbStockPublicationCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WbStockPublicationCheck_clientId_connectionId_createdAt_idx" ON "WbStockPublicationCheck"("clientId", "connectionId", "createdAt");
CREATE INDEX "WbStockPublicationCheck_runId_idx" ON "WbStockPublicationCheck"("runId");
CREATE TABLE "WbStockAvailabilityDay" (
 "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "connectionId" TEXT NOT NULL, "warehouseId" TEXT NOT NULL,
 "skuId" TEXT NOT NULL, "day" TEXT NOT NULL, "observedMask" INTEGER NOT NULL DEFAULT 0,
 "positiveMask" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "WbStockAvailabilityDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WbStockAvailabilityDay_connectionId_warehouseId_skuId_day_key" ON "WbStockAvailabilityDay"("connectionId", "warehouseId", "skuId", "day");
CREATE INDEX "WbStockAvailabilityDay_clientId_connectionId_day_idx" ON "WbStockAvailabilityDay"("clientId", "connectionId", "day");

CREATE UNIQUE INDEX "WbStockPublicationCheck_connectionId_warehouseId_chrtId_key" ON "WbStockPublicationCheck"("connectionId", "warehouseId", "chrtId");

-- ADDED: dedicated internal request type; ordinary receipt and FBS flows stay unchanged.
ALTER TYPE "ClientRequestType" ADD VALUE IF NOT EXISTS 'SKU_COLLECTION';

CREATE TYPE "SkuCollectionScanStatus" AS ENUM ('PICKED', 'RECEIVED');

CREATE TABLE "SkuCollectionSource" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "skuId" TEXT NOT NULL,
  "sourceBoxId" TEXT NOT NULL,
  "sourceBoxCode" TEXT NOT NULL,
  "plannedQuantity" INTEGER NOT NULL,
  "pickedQuantity" INTEGER NOT NULL DEFAULT 0,
  "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkuCollectionSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SkuCollectionScan" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "skuId" TEXT NOT NULL,
  "barcode" TEXT NOT NULL,
  "kiz" TEXT NOT NULL,
  "sourceBoxId" TEXT NOT NULL,
  "sourceBoxCode" TEXT NOT NULL,
  "targetBoxId" TEXT,
  "targetBoxCode" TEXT,
  "status" "SkuCollectionScanStatus" NOT NULL DEFAULT 'PICKED',
  "pickedByUserId" TEXT,
  "pickedByName" TEXT,
  "pickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedByUserId" TEXT,
  "receivedByName" TEXT,
  "receivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkuCollectionScan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SkuCollectionSource_requestId_sourceBoxId_skuId_key" ON "SkuCollectionSource"("requestId", "sourceBoxId", "skuId");
CREATE INDEX "SkuCollectionSource_warehouseId_clientId_skuId_idx" ON "SkuCollectionSource"("warehouseId", "clientId", "skuId");
CREATE INDEX "SkuCollectionSource_requestId_pickedQuantity_idx" ON "SkuCollectionSource"("requestId", "pickedQuantity");
CREATE UNIQUE INDEX "SkuCollectionScan_requestId_kiz_key" ON "SkuCollectionScan"("requestId", "kiz");
CREATE INDEX "SkuCollectionScan_requestId_status_idx" ON "SkuCollectionScan"("requestId", "status");
CREATE INDEX "SkuCollectionScan_sourceId_status_idx" ON "SkuCollectionScan"("sourceId", "status");

ALTER TABLE "SkuCollectionSource" ADD CONSTRAINT "SkuCollectionSource_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SkuCollectionScan" ADD CONSTRAINT "SkuCollectionScan_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SkuCollectionScan" ADD CONSTRAINT "SkuCollectionScan_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SkuCollectionSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

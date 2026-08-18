-- ADDED: изолированный контур погашения и возврата КИЗ; существующие складские таблицы не изменяются.
CREATE TYPE "KizCirculationOperation" AS ENUM ('RETIRE', 'RETURN');
CREATE TYPE "KizCirculationItemStatus" AS ENUM ('NEEDS_REVIEW', 'READY', 'ALREADY_APPLIED', 'IN_BATCH', 'SUBMITTED', 'APPLIED', 'ERROR', 'EXCLUDED');
CREATE TYPE "KizCirculationBatchStatus" AS ENUM ('DRAFT', 'SIGNED', 'SUBMITTED', 'APPLIED', 'REJECTED');

CREATE TABLE "KizTrueApiConnection" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "inn" TEXT NOT NULL,
  "kpp" TEXT,
  "fiasId" TEXT,
  "productGroup" TEXT NOT NULL,
  "apiBaseUrl" TEXT NOT NULL,
  "apiTokenEncrypted" TEXT NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3),
  "certificateSubject" TEXT,
  "certificateThumbprint" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastCheckedAt" TIMESTAMP(3),
  "lastCheckOk" BOOLEAN,
  "lastCheckMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KizTrueApiConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KizCirculationBatch" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "operation" "KizCirculationOperation" NOT NULL,
  "productGroup" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "status" "KizCirculationBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "payload" JSONB NOT NULL,
  -- FIX: подписывается и отправляется одна и та же неизменяемая последовательность байтов.
  "payloadJson" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "signatureEncrypted" TEXT,
  "crptDocumentId" TEXT,
  "crptStatus" TEXT,
  "crptError" TEXT,
  "submittedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KizCirculationBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KizCirculationItem" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "marketplace" "MarketplaceType" NOT NULL,
  "marketplaceConnectionId" TEXT,
  "operation" "KizCirculationOperation" NOT NULL,
  "sourceEventKey" TEXT NOT NULL,
  "orderId" TEXT,
  "requestId" TEXT,
  "assemblyId" TEXT,
  "skuId" TEXT,
  "kizRaw" TEXT NOT NULL,
  "cis" TEXT NOT NULL,
  "productGroup" TEXT NOT NULL,
  "productCostKopecks" INTEGER,
  "eventAt" TIMESTAMP(3) NOT NULL,
  "status" "KizCirculationItemStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "remoteStatus" TEXT,
  "remoteMessage" TEXT,
  "metadata" JSONB,
  "batchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KizCirculationItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KizTrueApiConnection_clientId_key" ON "KizTrueApiConnection"("clientId");
CREATE INDEX "KizTrueApiConnection_isActive_idx" ON "KizTrueApiConnection"("isActive");
CREATE UNIQUE INDEX "KizCirculationBatch_crptDocumentId_key" ON "KizCirculationBatch"("crptDocumentId");
CREATE INDEX "KizCirculationBatch_clientId_status_createdAt_idx" ON "KizCirculationBatch"("clientId", "status", "createdAt");
CREATE UNIQUE INDEX "KizCirculationItem_sourceEventKey_key" ON "KizCirculationItem"("sourceEventKey");
CREATE INDEX "KizCirculationItem_clientId_operation_status_eventAt_idx" ON "KizCirculationItem"("clientId", "operation", "status", "eventAt");
CREATE INDEX "KizCirculationItem_clientId_cis_idx" ON "KizCirculationItem"("clientId", "cis");
CREATE INDEX "KizCirculationItem_batchId_idx" ON "KizCirculationItem"("batchId");
CREATE INDEX "KizCirculationItem_orderId_idx" ON "KizCirculationItem"("orderId");

ALTER TABLE "KizTrueApiConnection" ADD CONSTRAINT "KizTrueApiConnection_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KizCirculationBatch" ADD CONSTRAINT "KizCirculationBatch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KizCirculationItem" ADD CONSTRAINT "KizCirculationItem_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KizCirculationItem" ADD CONSTRAINT "KizCirculationItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "KizCirculationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

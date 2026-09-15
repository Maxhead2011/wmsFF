-- Additive, isolated duplicate-label queue. No changes to stock or FBS rows.
CREATE TABLE "KizDuplicatePrinter" (
    "stationId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KizDuplicatePrinter_pkey" PRIMARY KEY ("stationId")
);
CREATE TABLE "KizDuplicateJob" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "kiz" TEXT NOT NULL,
    "product" JSONB NOT NULL,
    "imageBase64" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "requestedById" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "printedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KizDuplicateJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KizDuplicateJob_stationId_status_createdAt_idx" ON "KizDuplicateJob"("stationId", "status", "createdAt");
CREATE INDEX "KizDuplicateJob_clientId_createdAt_idx" ON "KizDuplicateJob"("clientId", "createdAt");
CREATE INDEX "KizDuplicateJob_requestedById_createdAt_idx" ON "KizDuplicateJob"("requestedById", "createdAt");

-- FIX: keep an optional visual snapshot for a TSD error without changing business operations.
ALTER TABLE "TsdOperation"
ADD COLUMN "screenshotData" BYTEA,
ADD COLUMN "screenshotMimeType" TEXT,
ADD COLUMN "screenshotCapturedAt" TIMESTAMP(3);

CREATE INDEX "TsdOperation_deviceId_createdAt_idx"
ON "TsdOperation"("deviceId", "createdAt");

CREATE INDEX "TsdOperation_operationType_createdAt_idx"
ON "TsdOperation"("operationType", "createdAt");

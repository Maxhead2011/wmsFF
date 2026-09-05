-- FIX: deploy only to our WMS after backup/review. Creation is opt-in.
CREATE TABLE "FbsAssemblyAttemptHistory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "workerUserId" TEXT,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "successorId" TEXT NOT NULL,
  "repeatRunId" TEXT NOT NULL,
  "taskSnapshot" JSONB NOT NULL,
  "kiz" TEXT,
  "linkSnapshot" JSONB NOT NULL,
  "archivedByUserId" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "FbsAssemblyAttemptHistory_successorId_key" ON "FbsAssemblyAttemptHistory"("successorId");
CREATE INDEX "FbsAssemblyAttemptHistory_requestId_idx" ON "FbsAssemblyAttemptHistory"("requestId");
CREATE INDEX "FbsAssemblyAttemptHistory_clientId_completedAt_idx" ON "FbsAssemblyAttemptHistory"("clientId", "completedAt");
CREATE INDEX "FbsAssemblyAttemptHistory_completedAt_workerUserId_idx" ON "FbsAssemblyAttemptHistory"("completedAt", "workerUserId");
CREATE INDEX "FbsAssemblyAttemptHistory_repeatRunId_idx" ON "FbsAssemblyAttemptHistory"("repeatRunId");
CREATE INDEX "FbsAssemblyAttemptHistory_clientId_kiz_idx" ON "FbsAssemblyAttemptHistory"("clientId", "kiz");
CREATE TABLE "FbsRepeatAssemblyRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "fingerprint" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "FbsRepeatAssemblyRun_fingerprint_key" ON "FbsRepeatAssemblyRun"("fingerprint");
CREATE UNIQUE INDEX "FbsRepeatAssemblyRun_requestId_key" ON "FbsRepeatAssemblyRun"("requestId");
-- FIX: do not hold a write-blocking index build on the existing print history.
-- Run outside a transaction. After the first repeat, rollback is read-only mode, not removal of history.
CREATE UNIQUE INDEX CONCURRENTLY "FbsWebKizStickerPrint_orderId_assemblyId_key" ON "FbsWebKizStickerPrint"("orderId", "assemblyId");
-- Older db-push installations own the index through a UNIQUE constraint.
-- The new composite index exists before either legacy form is removed.
SET lock_timeout = '5s';
ALTER TABLE "FbsWebKizStickerPrint" DROP CONSTRAINT IF EXISTS "FbsWebKizStickerPrint_orderId_key";
DROP INDEX CONCURRENTLY IF EXISTS "FbsWebKizStickerPrint_orderId_key";
RESET lock_timeout;

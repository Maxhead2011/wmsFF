-- FIX: immutable approval and idempotency record; no historical stock rewrite.
CREATE TABLE "FbsSizeSubstitution" (
  "taskId" TEXT PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL UNIQUE,
  "sourceSkuId" TEXT NOT NULL,
  "targetSkuId" TEXT NOT NULL,
  "approvedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

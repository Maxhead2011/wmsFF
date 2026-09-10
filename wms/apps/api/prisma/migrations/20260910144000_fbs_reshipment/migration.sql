-- FIX: additive and opt-in. No stock, history or existing request is changed.
CREATE TABLE "FbsReshipmentRun" (
  "id" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "previewToken" TEXT NOT NULL,
  "clientId" TEXT NOT NULL, "warehouseId" TEXT NOT NULL, "connectionId" TEXT NOT NULL,
  "mode" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "phase" TEXT NOT NULL DEFAULT 'PLANNED',
  "supplyName" TEXT NOT NULL, "supplyId" TEXT, "requestId" TEXT, "sourceRequestIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "snapshot" JSONB NOT NULL,
  "errorMessage" TEXT, "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FbsReshipmentRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FbsReshipmentRun_mode_check" CHECK ("mode" IN ('SAME_ITEM', 'NEW_ITEM'))
);
CREATE UNIQUE INDEX "FbsReshipmentRun_fingerprint_key" ON "FbsReshipmentRun"("fingerprint");
CREATE UNIQUE INDEX "FbsReshipmentRun_supplyName_key" ON "FbsReshipmentRun"("supplyName");
CREATE UNIQUE INDEX "FbsReshipmentRun_requestId_key" ON "FbsReshipmentRun"("requestId");
CREATE INDEX "FbsReshipmentRun_clientId_warehouseId_createdAt_idx" ON "FbsReshipmentRun"("clientId", "warehouseId", "createdAt");
CREATE INDEX "FbsReshipmentRun_sourceRequestIds_idx" ON "FbsReshipmentRun" USING GIN ("sourceRequestIds");
CREATE TABLE "FbsReshipmentClaim" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "connectionId" TEXT NOT NULL, "orderId" TEXT NOT NULL, "cycle" TEXT NOT NULL,
  CONSTRAINT "FbsReshipmentClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FbsReshipmentClaim_runId_fkey" FOREIGN KEY ("runId") REFERENCES "FbsReshipmentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FbsReshipmentClaim_connectionId_orderId_cycle_key" ON "FbsReshipmentClaim"("connectionId", "orderId", "cycle");
CREATE INDEX "FbsReshipmentClaim_runId_idx" ON "FbsReshipmentClaim"("runId");

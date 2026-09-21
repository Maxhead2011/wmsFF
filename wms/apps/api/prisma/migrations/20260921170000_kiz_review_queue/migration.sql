-- FIX: isolated review workflow, with no changes to inventory or existing KIZ history.
CREATE TABLE "KizReviewCase" (
 "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "warehouseId" TEXT NOT NULL,
 "taskId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "kizIdentity" TEXT NOT NULL,
 "kiz" TEXT NOT NULL, "context" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN',
 "decision" TEXT NOT NULL, "resolution" TEXT, "reason" TEXT, "decidedById" TEXT,
 "decidedByName" TEXT, "decidedAt" TIMESTAMP(3), "usedAt" TIMESTAMP(3),
 "snapshot" JSONB NOT NULL, "evidence" JSONB NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "KizReviewCase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KizReviewCase_taskId_kizIdentity_key" ON "KizReviewCase"("taskId", "kizIdentity");
CREATE INDEX "KizReviewCase_warehouseId_status_createdAt_idx" ON "KizReviewCase"("warehouseId", "status", "createdAt");
CREATE INDEX "KizReviewCase_clientId_warehouseId_status_idx" ON "KizReviewCase"("clientId", "warehouseId", "status");

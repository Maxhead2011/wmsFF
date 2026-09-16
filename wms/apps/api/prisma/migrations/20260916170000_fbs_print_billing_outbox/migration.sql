-- FIX: additive migration; existing print, shipment and invoice records are unchanged.
CREATE TABLE "FbsPrintBillingOutbox" (
    "clientId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    CONSTRAINT "FbsPrintBillingOutbox_pkey" PRIMARY KEY ("clientId")
);
CREATE INDEX "FbsPrintBillingOutbox_nextAttemptAt_idx" ON "FbsPrintBillingOutbox"("nextAttemptAt");

-- FIX: additive scheduler metadata; no stock quantities or shipment facts changed.
CREATE TABLE "WmsReconciliationCase" (
  "key" TEXT PRIMARY KEY, "clientId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "warehouseId" TEXT, "entityId" TEXT NOT NULL, "cause" TEXT NOT NULL, "label" TEXT NOT NULL,
  "evidenceVersion" TEXT NOT NULL, "leaseToken" TEXT, "leaseUntil" TIMESTAMPTZ,
  "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "reasonCode" TEXT, "assignedToId" TEXT, "lastAttemptAt" TIMESTAMPTZ,
  "resolvedAt" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "WmsReconciliationCase_client_due" ON "WmsReconciliationCase" ("clientId","nextAttemptAt");
CREATE INDEX "WmsReconciliationCase_request" ON "WmsReconciliationCase" ("requestId");

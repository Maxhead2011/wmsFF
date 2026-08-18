-- ADDED: Optional multi-warehouse FBS stock allocation. Existing publication behavior stays unchanged.
CREATE TABLE "FbsStockAllocationPolicy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "primaryWarehouseId" TEXT,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 10,
    "recommendationDays" INTEGER NOT NULL DEFAULT 30,
    "updatedSource" TEXT NOT NULL DEFAULT 'WMS',
    "changedByClientAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FbsStockAllocationPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FbsStockAllocationShare" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "warehouseName" TEXT,
    "percent" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FbsStockAllocationShare_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FbsStockIntegrationApiKey" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FbsStockIntegrationApiKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FbsStockAllocationOverride" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "requestedAmount" INTEGER NOT NULL,
    "updatedSource" TEXT NOT NULL DEFAULT 'WMS',
    "changedByClientAt" TIMESTAMP(3),
    "updatedByApiKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FbsStockAllocationOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FbsStockAllocationChange" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'EXTERNAL_CLIENT',
    "changeType" TEXT NOT NULL,
    "externalReference" TEXT,
    "payload" JSONB NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FbsStockAllocationChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FbsStockAllocationPolicy_connectionId_key" ON "FbsStockAllocationPolicy"("connectionId");
CREATE INDEX "FbsStockAllocationPolicy_clientId_enabled_idx" ON "FbsStockAllocationPolicy"("clientId", "enabled");
CREATE UNIQUE INDEX "FbsStockAllocationShare_policyId_warehouseId_key" ON "FbsStockAllocationShare"("policyId", "warehouseId");
CREATE INDEX "FbsStockAllocationShare_policyId_isPrimary_idx" ON "FbsStockAllocationShare"("policyId", "isPrimary");
CREATE UNIQUE INDEX "FbsStockIntegrationApiKey_keyHash_key" ON "FbsStockIntegrationApiKey"("keyHash");
CREATE INDEX "FbsStockIntegrationApiKey_clientId_isActive_idx" ON "FbsStockIntegrationApiKey"("clientId", "isActive");
CREATE UNIQUE INDEX "FbsStockAllocationOverride_policyId_skuId_key" ON "FbsStockAllocationOverride"("policyId", "skuId");
CREATE INDEX "FbsStockAllocationOverride_clientId_updatedSource_updatedAt_idx" ON "FbsStockAllocationOverride"("clientId", "updatedSource", "updatedAt");
CREATE INDEX "FbsStockAllocationOverride_updatedByApiKeyId_idx" ON "FbsStockAllocationOverride"("updatedByApiKeyId");
CREATE UNIQUE INDEX "FbsStockAllocationChange_apiKeyId_externalReference_key" ON "FbsStockAllocationChange"("apiKeyId", "externalReference");
CREATE INDEX "FbsStockAllocationChange_clientId_acknowledgedAt_createdAt_idx" ON "FbsStockAllocationChange"("clientId", "acknowledgedAt", "createdAt");
CREATE INDEX "FbsStockAllocationChange_policyId_createdAt_idx" ON "FbsStockAllocationChange"("policyId", "createdAt");

ALTER TABLE "FbsStockAllocationPolicy" ADD CONSTRAINT "FbsStockAllocationPolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FbsStockAllocationPolicy" ADD CONSTRAINT "FbsStockAllocationPolicy_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ClientMarketplaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FbsStockAllocationShare" ADD CONSTRAINT "FbsStockAllocationShare_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "FbsStockAllocationPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FbsStockIntegrationApiKey" ADD CONSTRAINT "FbsStockIntegrationApiKey_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FbsStockAllocationOverride" ADD CONSTRAINT "FbsStockAllocationOverride_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "FbsStockAllocationPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FbsStockAllocationOverride" ADD CONSTRAINT "FbsStockAllocationOverride_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FbsStockAllocationOverride" ADD CONSTRAINT "FbsStockAllocationOverride_updatedByApiKeyId_fkey" FOREIGN KEY ("updatedByApiKeyId") REFERENCES "FbsStockIntegrationApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FbsStockAllocationChange" ADD CONSTRAINT "FbsStockAllocationChange_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FbsStockAllocationChange" ADD CONSTRAINT "FbsStockAllocationChange_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "FbsStockAllocationPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FbsStockAllocationChange" ADD CONSTRAINT "FbsStockAllocationChange_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "FbsStockIntegrationApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FIX: additive, idempotent storage only. No automatic stock or legacy identity migration.
CREATE TABLE IF NOT EXISTS "MarketplaceProductLink" (
 "id" TEXT PRIMARY KEY, "clientId" TEXT NOT NULL REFERENCES "Client"("id") ON DELETE RESTRICT,
 "connectionId" TEXT NOT NULL REFERENCES "ClientMarketplaceConnection"("id") ON DELETE RESTRICT,
 "skuId" TEXT REFERENCES "Sku"("id") ON DELETE RESTRICT,
 "marketplace" TEXT NOT NULL, "productId" TEXT NOT NULL, "offerId" TEXT NOT NULL,
 "barcodes" TEXT[] NOT NULL, "size" TEXT, "color" TEXT, "status" TEXT NOT NULL,
 "reason" TEXT, "payload" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "MarketplaceProductLink_status_check" CHECK ((status='LINKED' AND "skuId" IS NOT NULL) OR (status='REVIEW' AND "skuId" IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceProductLink_connectionId_productId_key" ON "MarketplaceProductLink"("connectionId","productId");
CREATE INDEX IF NOT EXISTS "MarketplaceProductLink_clientId_skuId_idx" ON "MarketplaceProductLink"("clientId","skuId");
CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceProductLink_linked_sku_key" ON "MarketplaceProductLink"("connectionId","skuId") WHERE status='LINKED';

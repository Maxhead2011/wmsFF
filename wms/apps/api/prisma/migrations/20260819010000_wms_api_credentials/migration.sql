-- ADDED: isolated API credentials; the raw secret is never persisted.
CREATE TABLE "WmsApiCredential" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "allowedIps" JSONB,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WmsApiCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WmsApiCredential_keyPrefix_key" ON "WmsApiCredential"("keyPrefix");
CREATE UNIQUE INDEX "WmsApiCredential_keyHash_key" ON "WmsApiCredential"("keyHash");
CREATE INDEX "WmsApiCredential_clientId_warehouseId_revokedAt_idx" ON "WmsApiCredential"("clientId", "warehouseId", "revokedAt");
CREATE INDEX "WmsApiCredential_expiresAt_idx" ON "WmsApiCredential"("expiresAt");
CREATE INDEX "WmsApiCredential_createdByUserId_idx" ON "WmsApiCredential"("createdByUserId");

ALTER TABLE "WmsApiCredential" ADD CONSTRAINT "WmsApiCredential_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WmsApiCredential" ADD CONSTRAINT "WmsApiCredential_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WmsApiCredential" ADD CONSTRAINT "WmsApiCredential_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

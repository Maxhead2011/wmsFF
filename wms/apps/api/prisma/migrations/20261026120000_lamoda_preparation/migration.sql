-- CreateTable
CREATE TABLE "LamodaAccount" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "oauthClientId" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fboEnabled" BOOLEAN NOT NULL DEFAULT true,
    "fbsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "syncLeaseUntil" TIMESTAMP(3),
    "syncToken" TEXT,
    "checkedAt" TIMESTAMP(3),
    "ordersSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LamodaAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LamodaProduct" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "remoteSku" TEXT NOT NULL,
    "externalSku" TEXT,
    "barcode" TEXT,
    "size" TEXT,
    "name" TEXT NOT NULL,
    "skuId" TEXT,
    "linkState" TEXT NOT NULL DEFAULT 'UNLINKED',
    "isPresent" BOOLEAN NOT NULL DEFAULT true,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LamodaProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LamodaDocument" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LamodaDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LamodaPlan" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "remoteShipmentId" TEXT,
    "importHash" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LamodaPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LamodaExchange" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LamodaExchange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LamodaAccount_clientId_sellerId_key" ON "LamodaAccount"("clientId", "sellerId");

-- CreateIndex
CREATE INDEX "LamodaProduct_skuId_idx" ON "LamodaProduct"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "LamodaProduct_accountId_remoteSku_key" ON "LamodaProduct"("accountId", "remoteSku");

-- CreateIndex
CREATE UNIQUE INDEX "LamodaDocument_accountId_kind_remoteId_key" ON "LamodaDocument"("accountId", "kind", "remoteId");

-- CreateIndex
CREATE UNIQUE INDEX "LamodaPlan_accountId_warehouseId_importHash_key" ON "LamodaPlan"("accountId", "warehouseId", "importHash");

-- CreateIndex
CREATE INDEX "LamodaExchange_accountId_createdAt_idx" ON "LamodaExchange"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "LamodaAccount" ADD CONSTRAINT "LamodaAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LamodaProduct" ADD CONSTRAINT "LamodaProduct_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LamodaAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LamodaProduct" ADD CONSTRAINT "LamodaProduct_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LamodaDocument" ADD CONSTRAINT "LamodaDocument_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LamodaAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LamodaPlan" ADD CONSTRAINT "LamodaPlan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LamodaAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LamodaPlan" ADD CONSTRAINT "LamodaPlan_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LamodaExchange" ADD CONSTRAINT "LamodaExchange_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LamodaAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

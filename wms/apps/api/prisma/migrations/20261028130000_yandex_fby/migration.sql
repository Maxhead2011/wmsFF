CREATE TABLE "YandexFbyShipment" (
 "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "connectionId" TEXT NOT NULL,
 "importKey" TEXT NOT NULL, "remoteId" TEXT, "remoteNumber" TEXT, "remoteStatus" TEXT,
 "snapshot" JSONB, "checkedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "YandexFbyShipment_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "YandexFbyShipment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "YandexFbyShipment_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ClientMarketplaceConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "YandexFbyShipment_requestId_key" ON "YandexFbyShipment"("requestId");
CREATE UNIQUE INDEX "YandexFbyShipment_importKey_key" ON "YandexFbyShipment"("importKey");
CREATE UNIQUE INDEX "YandexFbyShipment_connectionId_remoteId_key" ON "YandexFbyShipment"("connectionId", "remoteId");

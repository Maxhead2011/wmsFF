CREATE TABLE "OzonFboOrderBinding" (
  "externalOrderKey" TEXT NOT NULL PRIMARY KEY,
  "requestId" TEXT NOT NULL REFERENCES "OzonFboShipment"("requestId") ON DELETE RESTRICT ON UPDATE CASCADE,
  "orderId" TEXT NOT NULL
);
CREATE INDEX "OzonFboOrderBinding_requestId_idx" ON "OzonFboOrderBinding"("requestId");
-- FIX: preserve the unique ownership of existing single-order bindings.
INSERT INTO "OzonFboOrderBinding" ("externalOrderKey", "requestId", "orderId")
SELECT "externalOrderKey", "requestId", "integration"->>'orderId'
FROM "OzonFboShipment" WHERE "externalOrderKey" IS NOT NULL AND "integration"->>'orderId' IS NOT NULL;

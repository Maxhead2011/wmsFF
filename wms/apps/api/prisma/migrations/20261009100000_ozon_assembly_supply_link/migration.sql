ALTER TABLE "OzonFboShipment" ADD COLUMN "externalOrderKey" TEXT, ADD COLUMN "integration" JSONB;
CREATE UNIQUE INDEX "OzonFboShipment_externalOrderKey_key" ON "OzonFboShipment"("externalOrderKey");

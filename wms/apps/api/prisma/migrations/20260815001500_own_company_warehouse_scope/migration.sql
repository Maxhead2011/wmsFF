ALTER TABLE "OwnCompany" ADD COLUMN "warehouseId" TEXT;

CREATE INDEX "OwnCompany_warehouseId_isActive_idx"
  ON "OwnCompany"("warehouseId", "isActive");

ALTER TABLE "OwnCompany"
  ADD CONSTRAINT "OwnCompany_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- FIX: additive nullable metadata; stock and historical statuses are unchanged.
ALTER TABLE "FbsOrderRequestLink"
  ADD COLUMN "orderPlacedAt" TIMESTAMP(3),
  ADD COLUMN "handedOverAt" TIMESTAMP(3),
  ADD COLUMN "sellerWarehouseId" TEXT,
  ADD COLUMN "sellerWarehouseName" TEXT;

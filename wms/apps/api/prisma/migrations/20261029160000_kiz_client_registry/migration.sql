-- FIX: additive history only; never rewrite stock, marks or shipment records.
CREATE TABLE "KizClientRegistry" (
  "clientId" TEXT NOT NULL,
  "identity" TEXT NOT NULL,
  "firstReceivedAt" TIMESTAMPTZ,
  "firstBoxCode" TEXT,
  "firstWarehouseId" TEXT,
  "productName" TEXT,
  "barcode" TEXT,
  "skuId" TEXT,
  "operationKey" TEXT,
  "sourceDocument" TEXT,
  "userId" TEXT,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KizClientRegistry_pkey" PRIMARY KEY ("clientId", "identity")
);

-- FIX: unknown/new KIZ lookups must not scan the complete TSD receipt log.
CREATE INDEX "TsdOperation_client_kiz_receipt_idx" ON "TsdOperation"
  ((payload->>'clientId'), (payload->>'kiz') text_pattern_ops)
  WHERE "operationType"='receipt_scan' AND status='ACCEPTED';
CREATE INDEX "ProductMark_client_kiz_prefix_idx" ON "ProductMark" ("clientId", value text_pattern_ops);
CREATE INDEX "ShippedKizHistory_client_kiz_prefix_idx" ON "ShippedKizHistory" ("clientId", kiz text_pattern_ops);
CREATE INDEX "FbsTsdAssembly_client_kiz_prefix_idx" ON "FbsTsdAssembly" ("clientId", kiz text_pattern_ops);
CREATE INDEX "FboAssemblyUnit_kiz_prefix_idx" ON "FboAssemblyUnit" (kiz text_pattern_ops);

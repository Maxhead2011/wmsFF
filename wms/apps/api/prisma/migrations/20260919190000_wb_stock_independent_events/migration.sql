-- FIX: append-only events do not serialize unrelated warehouse scans on one client row.
CREATE TABLE IF NOT EXISTS "WbStockSyncEvent" (
 id BIGSERIAL PRIMARY KEY, "clientId" TEXT NOT NULL, "skuIds" TEXT[] NOT NULL,
 "allSkus" BOOLEAN NOT NULL, txid BIGINT NOT NULL DEFAULT txid_current(),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "processedAt" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "WbStockSyncEvent_pending_idx" ON "WbStockSyncEvent" ("clientId", id) WHERE "processedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "WbStockSyncEvent_revision_idx" ON "WbStockSyncEvent" ("clientId", txid);
CREATE OR REPLACE FUNCTION wms_wb_stock_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r JSONB; old_r JSONB; fields TEXT[]; c TEXT; old_c TEXT; filtered JSONB; old_filtered JSONB; skus TEXT[]; all_skus BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "SystemSetting" WHERE key = 'marketplace.wbUrgentSync.enabled' AND value = 'true'::jsonb) THEN RETURN NULL; END IF;
  r := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  old_r := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  fields := string_to_array(TG_ARGV[0], ',');
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(key,value) INTO filtered FROM jsonb_each(r) WHERE key = ANY(fields);
    SELECT jsonb_object_agg(key,value) INTO old_filtered FROM jsonb_each(old_r) WHERE key = ANY(fields);
    IF filtered IS NOT DISTINCT FROM old_filtered THEN RETURN NULL; END IF;
  END IF;
  c := r->>'clientId'; old_c := old_r->>'clientId';
  IF TG_TABLE_NAME = 'ClientRequestItem' THEN
    SELECT "clientId" INTO c FROM "ClientRequest" WHERE id = r->>'requestId';
    SELECT "clientId" INTO old_c FROM "ClientRequest" WHERE id = old_r->>'requestId';
  ELSIF TG_TABLE_NAME = 'FbsStockAllocationShare' THEN
    SELECT "clientId" INTO c FROM "FbsStockAllocationPolicy" WHERE id = r->>'policyId';
    SELECT "clientId" INTO old_c FROM "FbsStockAllocationPolicy" WHERE id = old_r->>'policyId';
  ELSIF TG_TABLE_NAME = 'SystemSetting' THEN
    IF r->>'key' ~ '^marketplace\.(wbReserve\.client|stockControl\.client|wbSkuRule)\.' THEN
      c := substring(r->>'key' FROM '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
    ELSE RETURN NULL; END IF;
  END IF;
  skus := ARRAY(SELECT DISTINCT v FROM unnest(ARRAY[r->>'skuId',old_r->>'skuId',r->>'sourceSkuId',old_r->>'sourceSkuId']) AS v WHERE v IS NOT NULL);
  IF TG_TABLE_NAME = 'ClientRequest' THEN
    skus := ARRAY(SELECT DISTINCT "skuId" FROM "ClientRequestItem" WHERE "requestId" = r->>'id' AND "skuId" IS NOT NULL);
    IF cardinality(skus) = 0 AND TG_OP <> 'DELETE' THEN RETURN NULL; END IF;
  ELSIF TG_TABLE_NAME = 'Box' THEN
    skus := ARRAY(SELECT DISTINCT "skuId" FROM "StockBalance" WHERE "boxId" = r->>'id');
    IF cardinality(skus) = 0 THEN RETURN NULL; END IF;
  ELSIF TG_TABLE_NAME = 'Sku' THEN
    skus := ARRAY[r->>'id'];
  ELSIF TG_TABLE_NAME = 'FbsOrderRequestLink' THEN
    skus := ARRAY(SELECT DISTINCT v FROM "FbsTsdAssembly" t CROSS JOIN LATERAL unnest(ARRAY[t."skuId",t."sourceSkuId"]) v
      WHERE t."clientId" = c AND t."orderId" = r->>'orderId' AND t."connectionId" = r->>'connectionId' AND v IS NOT NULL);
  END IF;
  all_skus := cardinality(skus) = 0;
  FOR c IN SELECT DISTINCT v FROM unnest(ARRAY[c,old_c]) AS v WHERE v IS NOT NULL ORDER BY v LOOP
    INSERT INTO "WbStockSyncEvent" ("clientId", "skuIds", "allSkus") VALUES (c, skus, all_skus);
  END LOOP;
  RETURN NULL;
END $$;

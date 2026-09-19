-- FIX: durable change revisions; no triggers are active until explicitly enabled on our WMS.
CREATE TABLE IF NOT EXISTS "WbStockSyncQueue" (
  "clientId" TEXT PRIMARY KEY, revision BIGINT NOT NULL DEFAULT 1,
  "completedRevision" BIGINT NOT NULL DEFAULT 0, "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT now(), attempts INTEGER NOT NULL DEFAULT 0,
  "skuIds" TEXT[] NOT NULL DEFAULT ARRAY[]::text[], "allSkus" BOOLEAN NOT NULL DEFAULT false,
  "leaseToken" TEXT, "leaseUntil" TIMESTAMPTZ, "lastError" TEXT
);
CREATE INDEX IF NOT EXISTS "WbStockSyncQueue_pending_idx" ON "WbStockSyncQueue" ("nextAttemptAt", "requestedAt") WHERE revision > "completedRevision";
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
    INSERT INTO "WbStockSyncQueue" ("clientId", "skuIds", "allSkus") VALUES (c, skus, all_skus)
    ON CONFLICT ("clientId") DO UPDATE SET revision = "WbStockSyncQueue".revision + 1,
      "skuIds" = ARRAY(SELECT DISTINCT v FROM unnest("WbStockSyncQueue"."skuIds" || EXCLUDED."skuIds") AS v),
      "allSkus" = "WbStockSyncQueue"."allSkus" OR EXCLUDED."allSkus",
      "requestedAt" = now(), "nextAttemptAt" = LEAST("WbStockSyncQueue"."nextAttemptAt", now());
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS "wb_stock_change_StockBalance" ON "StockBalance";
CREATE TRIGGER "wb_stock_change_StockBalance" AFTER INSERT OR UPDATE OR DELETE ON "StockBalance" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('clientId,skuId,warehouseId,boxId,status,quantity');
DROP TRIGGER IF EXISTS "wb_stock_change_StockMovement" ON "StockMovement";
CREATE TRIGGER "wb_stock_change_StockMovement" AFTER INSERT OR UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('clientId,skuId,warehouseId,status,type,quantity,sourceDocument,idempotencyKey');
DROP TRIGGER IF EXISTS "wb_stock_change_FbsTsdAssembly" ON "FbsTsdAssembly";
CREATE TRIGGER "wb_stock_change_FbsTsdAssembly" AFTER INSERT OR UPDATE OR DELETE ON "FbsTsdAssembly" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('clientId,skuId,sourceSkuId,stockWarehouseId,itemCount,status,relabelConfirmedAt,requestId');
DROP TRIGGER IF EXISTS "wb_stock_change_ClientRequest" ON "ClientRequest";
CREATE TRIGGER "wb_stock_change_ClientRequest" AFTER INSERT OR UPDATE OR DELETE ON "ClientRequest" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('clientId,warehouseId,type,status');
DROP TRIGGER IF EXISTS "wb_stock_change_ClientRequestItem" ON "ClientRequestItem";
CREATE TRIGGER "wb_stock_change_ClientRequestItem" AFTER INSERT OR UPDATE OR DELETE ON "ClientRequestItem" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('requestId,skuId,barcode,quantity');
DROP TRIGGER IF EXISTS "wb_stock_change_ClientArticleMapping" ON "ClientArticleMapping";
CREATE TRIGGER "wb_stock_change_ClientArticleMapping" AFTER INSERT OR UPDATE OR DELETE ON "ClientArticleMapping" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('clientId,sourceArticle,targetArticle');
DROP TRIGGER IF EXISTS "wb_stock_change_FbsStockAllocationPolicy" ON "FbsStockAllocationPolicy";
CREATE TRIGGER "wb_stock_change_FbsStockAllocationPolicy" AFTER INSERT OR UPDATE OR DELETE ON "FbsStockAllocationPolicy" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('clientId,enabled,primaryWarehouseId,lowStockThreshold');
DROP TRIGGER IF EXISTS "wb_stock_change_FbsStockAllocationShare" ON "FbsStockAllocationShare";
CREATE TRIGGER "wb_stock_change_FbsStockAllocationShare" AFTER INSERT OR UPDATE OR DELETE ON "FbsStockAllocationShare" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('policyId,warehouseId,percent,isPrimary');
DROP TRIGGER IF EXISTS "wb_stock_change_FbsStockAllocationOverride" ON "FbsStockAllocationOverride";
CREATE TRIGGER "wb_stock_change_FbsStockAllocationOverride" AFTER INSERT OR UPDATE OR DELETE ON "FbsStockAllocationOverride" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('clientId,policyId,skuId,requestedAmount');
DROP TRIGGER IF EXISTS "wb_stock_change_SystemSetting" ON "SystemSetting";
CREATE TRIGGER "wb_stock_change_SystemSetting" AFTER INSERT OR UPDATE OR DELETE ON "SystemSetting" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('key,value');
DROP TRIGGER IF EXISTS "wb_stock_change_Box" ON "Box";
CREATE TRIGGER "wb_stock_change_Box" AFTER INSERT OR UPDATE OR DELETE ON "Box" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('clientId,warehouseId,status');
DROP TRIGGER IF EXISTS "wb_stock_change_Sku" ON "Sku";
CREATE TRIGGER "wb_stock_change_Sku" AFTER INSERT OR UPDATE OR DELETE ON "Sku" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('clientId,marketplaceProductId,isDraft,article,size');
DROP TRIGGER IF EXISTS "wb_stock_change_FbsOrderRequestLink" ON "FbsOrderRequestLink";
CREATE TRIGGER "wb_stock_change_FbsOrderRequestLink" AFTER INSERT OR UPDATE OR DELETE ON "FbsOrderRequestLink" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('clientId,requestId,lastCategory');
DROP TRIGGER IF EXISTS "wb_stock_change_FbsStockPublication" ON "FbsStockPublication";
CREATE TRIGGER "wb_stock_change_FbsStockPublication" AFTER UPDATE OR DELETE ON "FbsStockPublication" FOR EACH ROW EXECUTE FUNCTION wms_wb_stock_changed('clientId,enabled,saleLimit,relabelManualAmount');

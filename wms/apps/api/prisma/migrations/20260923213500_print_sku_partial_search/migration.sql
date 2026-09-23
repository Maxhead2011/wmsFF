-- FIX: indexed substring search over synchronized client cards, without loading the catalog.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Sku_name_trgm_idx" ON "Sku" USING GIN ("name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Sku_article_trgm_idx" ON "Sku" USING GIN ("article" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Sku_internalSku_trgm_idx" ON "Sku" USING GIN ("internalSku" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Barcode_value_trgm_idx" ON "Barcode" USING GIN ("value" gin_trgm_ops);

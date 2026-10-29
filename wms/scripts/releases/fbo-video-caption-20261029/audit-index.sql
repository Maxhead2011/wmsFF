-- Prepared only; psql against OUR WMS after release approval. Never sold WMS.
-- CONCURRENTLY must run outside a transaction.
\set ON_ERROR_STOP on
DO $$
DECLARE existing regclass := to_regclass('public."AuditLog_contour_createdAt_id_idx"');
BEGIN
  -- FIX: do not mistake an interrupted or differently defined index for a valid one.
  IF existing IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_am am ON am.oid = c.relam
    WHERE i.indexrelid = existing AND i.indrelid = 'public."AuditLog"'::regclass
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND i.indnkeyatts = 2 AND i.indnatts = 2 AND i.indoption::text = '0 0' AND i.indpred IS NULL AND i.indexprs IS NULL
      AND am.amname = 'btree' AND pg_get_indexdef(i.indexrelid, 1, true) = '"createdAt"'
      AND pg_get_indexdef(i.indexrelid, 2, true) = 'id'
  ) THEN RAISE EXCEPTION 'Existing contour audit index is invalid or different; review without automatic DROP';
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_contour_createdAt_id_idx"
  ON public."AuditLog" ("createdAt", "id");

SELECT c.relname, i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid)
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indexrelid = 'public."AuditLog_contour_createdAt_id_idx"'::regclass;

-- Read-only verification; also retain EXPLAIN for the actual exporter query.
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "createdAt" FROM public."AuditLog"
WHERE "createdAt" >= now() - interval '90 seconds'
ORDER BY "createdAt", "id" LIMIT 200;

-- Rollback disables the flag and bridge audit polling. Keep this index and all audit data.

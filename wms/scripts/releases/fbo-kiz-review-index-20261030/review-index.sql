-- Prepared only; psql against OUR WMS after release approval. Never sold WMS.
-- CONCURRENTLY must run outside a transaction.
\set ON_ERROR_STOP on
DO $$
DECLARE existing regclass := to_regclass('public."KizReviewCase_client_identity_idx"');
BEGIN
  -- FIX: do not mistake an interrupted or differently defined index for a valid one.
  IF existing IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_am am ON am.oid = c.relam
    WHERE i.indexrelid = existing AND i.indrelid = 'public."KizReviewCase"'::regclass
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND i.indnkeyatts = 2 AND i.indnatts = 2 AND i.indoption::text = '0 0' AND i.indpred IS NULL AND i.indexprs IS NULL
      AND am.amname = 'btree' AND pg_get_indexdef(i.indexrelid, 1, true) = '"clientId"'
      AND pg_get_indexdef(i.indexrelid, 2, true) = '"kizIdentity"'
  ) THEN RAISE EXCEPTION 'Existing KIZ review index is invalid or different; review without automatic DROP';
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "KizReviewCase_client_identity_idx"
  ON public."KizReviewCase" ("clientId", "kizIdentity");

SELECT c.relname, i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid)
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indexrelid = 'public."KizReviewCase_client_identity_idx"'::regclass;


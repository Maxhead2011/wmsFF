-- TEST: run using psql against a local test database; every change rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA ozon_tsd_migration_test;
SET LOCAL search_path TO ozon_tsd_migration_test;
CREATE TABLE "FbsTsdAssembly" (id text PRIMARY KEY, barcode text);
INSERT INTO "FbsTsdAssembly" VALUES ('legacy', '2046905830135');
\ir ../prisma/migrations/202609160001_ozon_tsd_unit_scans/migration.sql
DO $$
BEGIN
  IF (SELECT "scannedItemCount" FROM "FbsTsdAssembly" WHERE id = 'legacy') <> 0 THEN
    RAISE EXCEPTION 'Migration must not invent physical scans';
  END IF;
END $$;
UPDATE "FbsTsdAssembly" SET "scannedItemCount" = 2 WHERE id = 'legacy';
UPDATE "FbsTsdAssembly" SET barcode = NULL WHERE id = 'legacy';
UPDATE "FbsTsdAssembly" SET barcode = '2046905830135' WHERE id = 'legacy';
DO $$
BEGIN
  IF (SELECT "scannedItemCount" FROM "FbsTsdAssembly" WHERE id = 'legacy') <> 0 THEN
    RAISE EXCEPTION 'Release and re-assignment must not restore old scans';
  END IF;
  BEGIN
    UPDATE "FbsTsdAssembly" SET "scannedItemCount" = -1 WHERE id = 'legacy';
    RAISE EXCEPTION 'Negative progress was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
ROLLBACK;

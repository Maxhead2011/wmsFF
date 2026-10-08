\set ON_ERROR_STOP on
-- TEST: disposable PostgreSQL fixture only, never run this harness against WMS.
CREATE TABLE "Box"(id TEXT PRIMARY KEY,code TEXT UNIQUE,"clientId" TEXT,"warehouseId" TEXT,status TEXT);
CREATE TABLE "StockMovement"(id TEXT PRIMARY KEY,"boxId" TEXT REFERENCES "Box"(id),"clientId" TEXT,"warehouseId" TEXT,type TEXT,quantity INT,"createdAt" TIMESTAMP(3));
CREATE TABLE "TsdOperation"(id TEXT PRIMARY KEY,"operationType" TEXT,status TEXT,payload JSONB,"createdAt" TIMESTAMP(3));
INSERT INTO "Box" VALUES('b','BOX_001','c','w','active'),('empty','EMPTY_001','c','w','active');
INSERT INTO "StockMovement" VALUES('m','b','c','w','RECEIPT',3,'2026-10-01');
\i /test/migration.sql
CREATE FUNCTION check_identity(b TEXT,r TIMESTAMP,m TIMESTAMP) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM "ReceiptStockIdentity" WHERE "boxId"=b AND "receiptAt" IS NOT DISTINCT FROM r AND "movementAt" IS NOT DISTINCT FROM m)
    THEN RAISE EXCEPTION 'Identity mismatch for %',b; END IF;
END $$;
SELECT check_identity('b','2026-10-01','2026-10-01');
SELECT check_identity('empty',NULL,NULL);
INSERT INTO "TsdOperation" VALUES('open','receipt_open_box','ACCEPTED','{"boxCode":"BOX_001","clientId":"c","warehouseId":"w","sourceDocument":"R"}','2026-10-02');
SELECT check_identity('b','2026-10-02','2026-10-01');
INSERT INTO "TsdOperation" VALUES('wrong','receipt_box_status','ACCEPTED','{"boxCode":"BOX_001","clientId":"other","warehouseId":"w","sourceDocument":"R"}','2026-10-09');
INSERT INTO "TsdOperation" VALUES('invalid','receipt_box_status','ACCEPTED','{"boxCode":"BOX_001","clientId":"c","warehouseId":"w","sourceDocument":123}','2026-10-09');
SELECT check_identity('b','2026-10-02','2026-10-01');
UPDATE "TsdOperation" SET status='REJECTED' WHERE id='open';
SELECT check_identity('b','2026-10-01','2026-10-01');
UPDATE "TsdOperation" SET status='ACCEPTED' WHERE id='open';
DELETE FROM "StockMovement" WHERE id='m';
SELECT check_identity('b','2026-10-02',NULL);
INSERT INTO "StockMovement" VALUES('m2','b','c','w','RECEIPT',3,'2027-01-02');
SELECT check_identity('b','2027-01-02','2027-01-02');
UPDATE "StockMovement" SET quantity=0 WHERE id='m2';
SELECT check_identity('b','2026-10-02',NULL);
UPDATE "StockMovement" SET quantity=1,"boxId"='empty' WHERE id='m2';
SELECT check_identity('empty','2027-01-02','2027-01-02');
SELECT check_identity('b','2026-10-02',NULL);
BEGIN;
INSERT INTO "StockMovement" VALUES('rollback','b','c','w','RECEIPT',1,'2028-01-01');
SELECT check_identity('b','2028-01-01','2028-01-01');
ROLLBACK;
SELECT check_identity('b','2026-10-02',NULL);
UPDATE "Box" SET "warehouseId"='other' WHERE id='b';
SELECT check_identity('b',NULL,NULL);
UPDATE "Box" SET "warehouseId"='w' WHERE id='b';
SELECT check_identity('b','2026-10-02',NULL);
DELETE FROM "TsdOperation" WHERE id='open';
SELECT check_identity('b',NULL,NULL);
DELETE FROM "Box" WHERE id='b';
DO $$BEGIN IF EXISTS(SELECT 1 FROM "ReceiptStockIdentity" WHERE "boxId"='b') THEN RAISE EXCEPTION 'Orphan identity'; END IF; END$$;
INSERT INTO "Box" VALUES('concurrent','CONCURRENT_001','c','w','active');
SELECT 'PASS: backfill, append, correction, deletion, wrong scope, invalid payload, year reuse, rollback, box move and cascading delete';

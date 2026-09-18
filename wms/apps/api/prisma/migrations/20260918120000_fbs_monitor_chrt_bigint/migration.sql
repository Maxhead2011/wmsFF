-- FIX: WB size identifiers exceed signed INT4.
ALTER TABLE "FbsStockMonitorEvent" ALTER COLUMN "chrtId" TYPE BIGINT USING "chrtId"::BIGINT;

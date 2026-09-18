-- FIX: WB size IDs exceed the signed 32-bit range; preserve existing IDs and unique index.
ALTER TABLE "WbStockPublicationCheck" ALTER COLUMN "chrtId" TYPE BIGINT USING "chrtId"::BIGINT;

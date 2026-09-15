-- FIX: additive migration; existing active barcodes are interpreted as one scan.
ALTER TABLE "FbsTsdAssembly" ADD COLUMN "scannedItemCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FbsTsdAssembly" ADD CONSTRAINT "FbsTsdAssembly_scannedItemCount_nonnegative" CHECK ("scannedItemCount" >= 0);

-- FIX: all release/undo paths clear barcode, including administrative operations.
CREATE FUNCTION reset_fbs_scanned_item_count() RETURNS trigger AS $$
BEGIN
  IF NEW.barcode IS NULL THEN
    NEW."scannedItemCount" := 0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FbsTsdAssembly_reset_scanned_item_count"
BEFORE INSERT OR UPDATE ON "FbsTsdAssembly"
FOR EACH ROW EXECUTE FUNCTION reset_fbs_scanned_item_count();

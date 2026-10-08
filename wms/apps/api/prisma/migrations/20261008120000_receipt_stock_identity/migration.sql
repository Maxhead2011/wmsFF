-- FIX: receipt evidence changes atomically with its source, never while reading a pick plan.
CREATE TABLE "ReceiptStockIdentity" (
  "boxId" TEXT PRIMARY KEY REFERENCES "Box"(id) ON DELETE CASCADE,
  "receiptAt" TIMESTAMP(3),
  "movementAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ReceiptStockIdentity_receiptAt_idx" ON "ReceiptStockIdentity"("receiptAt");
CREATE INDEX "StockMovement_receipt_identity_idx" ON "StockMovement"("boxId","createdAt" DESC)
  WHERE type='RECEIPT' AND quantity>0;
CREATE INDEX "TsdOperation_receipt_identity_idx" ON "TsdOperation"
  ((payload->>'boxCode'),(payload->>'clientId'),(payload->>'warehouseId'),"createdAt" DESC)
  WHERE "operationType" IN ('receipt_open_box','receipt_box_status') AND status='ACCEPTED'
    AND jsonb_typeof(payload->'sourceDocument')='string' AND payload->>'sourceDocument'<>'';

CREATE FUNCTION wms_refresh_receipt_stock_identity(target TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE b RECORD; movement_at TIMESTAMP(3); opening_at TIMESTAMP(3);
BEGIN
  -- Compatible with FK KEY SHARE; serialize two receipt writers for the same box.
  SELECT id,code,"clientId","warehouseId" INTO b FROM "Box" WHERE id=target FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT "createdAt" INTO movement_at FROM "StockMovement"
    WHERE "boxId"=b.id AND "clientId"=b."clientId" AND "warehouseId"=b."warehouseId"
      AND type='RECEIPT' AND quantity>0 ORDER BY "createdAt" DESC LIMIT 1;
  SELECT "createdAt" INTO opening_at FROM "TsdOperation"
    WHERE "operationType" IN ('receipt_open_box','receipt_box_status') AND status='ACCEPTED'
      AND payload->>'boxCode'=b.code AND payload->>'clientId'=b."clientId"
      AND payload->>'warehouseId'=b."warehouseId"
      AND jsonb_typeof(payload->'sourceDocument')='string' AND payload->>'sourceDocument'<>''
    ORDER BY "createdAt" DESC LIMIT 1;
  INSERT INTO "ReceiptStockIdentity"("boxId","receiptAt","movementAt","updatedAt")
    VALUES(b.id,GREATEST(movement_at,opening_at),movement_at,CURRENT_TIMESTAMP)
    ON CONFLICT("boxId") DO UPDATE SET "receiptAt"=EXCLUDED."receiptAt",
      "movementAt"=EXCLUDED."movementAt","updatedAt"=EXCLUDED."updatedAt";
END $$;

CREATE FUNCTION wms_receipt_identity_box_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM wms_refresh_receipt_stock_identity(NEW.id); RETURN NEW;
END $$;
CREATE TRIGGER wms_receipt_identity_box AFTER INSERT OR UPDATE OF code,"clientId","warehouseId" ON "Box"
  FOR EACH ROW EXECUTE FUNCTION wms_receipt_identity_box_trigger();

CREATE FUNCTION wms_receipt_identity_movement_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE old_box TEXT; new_box TEXT; target TEXT;
BEGIN
  IF TG_OP<>'INSERT' AND OLD.type='RECEIPT' AND OLD.quantity>0 THEN old_box:=OLD."boxId"; END IF;
  IF TG_OP<>'DELETE' AND NEW.type='RECEIPT' AND NEW.quantity>0 THEN new_box:=NEW."boxId"; END IF;
  FOR target IN SELECT DISTINCT x FROM unnest(ARRAY[old_box,new_box]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM wms_refresh_receipt_stock_identity(target);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER wms_receipt_identity_movement AFTER INSERT OR UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION wms_receipt_identity_movement_trigger();

CREATE FUNCTION wms_receipt_identity_operation_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE old_payload JSONB; new_payload JSONB; target TEXT;
BEGIN
  IF TG_OP<>'INSERT' AND OLD."operationType" IN ('receipt_open_box','receipt_box_status') AND OLD.status='ACCEPTED'
    THEN old_payload:=OLD.payload; END IF;
  IF TG_OP<>'DELETE' AND NEW."operationType" IN ('receipt_open_box','receipt_box_status') AND NEW.status='ACCEPTED'
    THEN new_payload:=NEW.payload; END IF;
  FOR target IN SELECT id FROM "Box" WHERE
    (code=old_payload->>'boxCode' AND "clientId"=old_payload->>'clientId' AND "warehouseId"=old_payload->>'warehouseId') OR
    (code=new_payload->>'boxCode' AND "clientId"=new_payload->>'clientId' AND "warehouseId"=new_payload->>'warehouseId') ORDER BY id LOOP
    PERFORM wms_refresh_receipt_stock_identity(target);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER wms_receipt_identity_operation AFTER INSERT OR UPDATE OR DELETE ON "TsdOperation"
  FOR EACH ROW EXECUTE FUNCTION wms_receipt_identity_operation_trigger();

-- Initial backfill runs once under the migration transaction; read paths never rebuild it.
SELECT wms_refresh_receipt_stock_identity(id) FROM "Box" ORDER BY id;

-- FIX: install only in our WMS; no original document/payment data is rewritten.
CREATE TABLE "BillingPeriodClose" (
 "id" TEXT PRIMARY KEY, "clientId" TEXT NOT NULL REFERENCES "Client"("id") ON DELETE RESTRICT,
 "warehouseId" TEXT NOT NULL REFERENCES "Warehouse"("id") ON DELETE RESTRICT,
 "periodFrom" TIMESTAMP(3) NOT NULL, "periodTo" TIMESTAMP(3) NOT NULL,
 "invoiceIds" TEXT[] NOT NULL, "snapshot" JSONB NOT NULL, "previewHash" TEXT NOT NULL,
 "reason" TEXT NOT NULL CHECK (length(btrim("reason")) BETWEEN 1 AND 1000),
 "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK ("periodFrom" <= "periodTo")
);
CREATE INDEX "BillingPeriodClose_clientId_warehouseId_periodFrom_periodTo_idx" ON "BillingPeriodClose"("clientId","warehouseId","periodFrom","periodTo");
CREATE INDEX "BillingPeriodClose_invoiceIds_idx" ON "BillingPeriodClose" USING GIN ("invoiceIds");
CREATE TABLE "BillingInvoiceCorrection" (
 "id" TEXT PRIMARY KEY, "invoiceId" TEXT NOT NULL REFERENCES "BillingInvoice"("id") ON DELETE RESTRICT,
 "amountRub" DECIMAL(14,2) NOT NULL, "kind" TEXT NOT NULL DEFAULT 'ADJUSTMENT',
 "reason" TEXT NOT NULL CHECK (length(btrim("reason")) BETWEEN 1 AND 1000),
 "operationKey" TEXT NOT NULL UNIQUE, "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("kind" = 'ADJUSTMENT' AND "amountRub" <> 0) OR ("kind" = 'LATE_WORK' AND "amountRub" = 0))
);
CREATE INDEX "BillingInvoiceCorrection_invoiceId_createdAt_idx" ON "BillingInvoiceCorrection"("invoiceId","createdAt");
CREATE FUNCTION wms_billing_snapshot_protected(invoice_id TEXT) RETURNS BOOLEAN LANGUAGE SQL VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM "BillingPeriodClose" WHERE "invoiceIds" @> ARRAY[invoice_id])
 OR EXISTS(SELECT 1 FROM "BillingInvoiceCorrection" WHERE "invoiceId" = invoice_id)
$$;
CREATE FUNCTION wms_billing_snapshot_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE invoice_id TEXT;
BEGIN
 IF TG_TABLE_NAME = 'BillingInvoice' THEN
  invoice_id := OLD.id;
  IF NOT wms_billing_snapshot_protected(invoice_id) THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'WMS_BILLING_PERIOD_CLOSED: original invoice cannot be deleted' USING ERRCODE='23514'; END IF;
  IF NEW.status::TEXT NOT IN ('ISSUED','PAID') OR
   (to_jsonb(OLD)-ARRAY['paidRub','paidAt','status','updatedAt']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['paidRub','paidAt','status','updatedAt']) THEN
    RAISE EXCEPTION 'WMS_BILLING_PERIOD_CLOSED: use a separate correction document' USING ERRCODE='23514';
  END IF;
 ELSE
  -- Parent locks make a concurrent line insertion wait until close publishes its snapshot.
  IF TG_OP <> 'INSERT' THEN PERFORM id FROM "BillingInvoice" WHERE id=OLD."invoiceId" FOR UPDATE; END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM id FROM "BillingInvoice" WHERE id=NEW."invoiceId" FOR UPDATE; END IF;
  IF TG_OP <> 'INSERT' AND wms_billing_snapshot_protected(OLD."invoiceId") THEN
   RAISE EXCEPTION 'WMS_BILLING_PERIOD_CLOSED: original invoice lines are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP <> 'DELETE' AND wms_billing_snapshot_protected(NEW."invoiceId") THEN
   RAISE EXCEPTION 'WMS_BILLING_PERIOD_CLOSED: original invoice lines are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER wms_billing_invoice_snapshot BEFORE UPDATE OR DELETE ON "BillingInvoice" FOR EACH ROW EXECUTE FUNCTION wms_billing_snapshot_guard();
CREATE TRIGGER wms_billing_line_snapshot BEFORE INSERT OR UPDATE OR DELETE ON "BillingInvoiceItem" FOR EACH ROW EXECUTE FUNCTION wms_billing_snapshot_guard();
CREATE FUNCTION wms_billing_close_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'WMS_BILLING_PERIOD_CLOSED: close/correction records are immutable; add a reversal document' USING ERRCODE='23514'; END $$;
CREATE TRIGGER wms_billing_close_immutable BEFORE UPDATE OR DELETE ON "BillingPeriodClose" FOR EACH ROW EXECUTE FUNCTION wms_billing_close_immutable();
CREATE TRIGGER wms_billing_correction_immutable BEFORE UPDATE OR DELETE ON "BillingInvoiceCorrection" FOR EACH ROW EXECUTE FUNCTION wms_billing_close_immutable();

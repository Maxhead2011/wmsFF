-- TEST: a permanent close freezes original financial rows, while receipts and new late drafts remain possible.
INSERT INTO "BillingPeriodClose" VALUES ('close','c','w','2026-09-01','2026-09-30',ARRAY['i'],'[]','hash','Reviewed','u',NOW());
DO $$ BEGIN
 BEGIN UPDATE "BillingInvoice" SET "totalRub"=200 WHERE id='i'; RAISE EXCEPTION 'original amount was editable'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE "BillingInvoice" SET status='DRAFT' WHERE id='i'; RAISE EXCEPTION 'snapshot was reopened'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM "BillingInvoice" WHERE id='i'; RAISE EXCEPTION 'snapshot was deleted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE "BillingInvoiceItem" SET "totalRub"=200 WHERE id='item'; RAISE EXCEPTION 'line was editable'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN INSERT INTO "BillingInvoiceItem" VALUES ('extra','i',100); RAISE EXCEPTION 'line was appended'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM "BillingInvoiceItem" WHERE id='item'; RAISE EXCEPTION 'line was deleted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM "BillingPeriodClose"; RAISE EXCEPTION 'close was deletable'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE "BillingInvoice" SET "paidRub"=55 WHERE id='i';
INSERT INTO "BillingInvoiceItem" VALUES ('late-item','late',50);
INSERT INTO "BillingInvoiceCorrection" VALUES ('credit','i',-75,'ADJUSTMENT','Wrong service','operation','u',NOW());
UPDATE "BillingInvoice" SET status='PAID',"paidAt"=NOW() WHERE id='i';
DO $$ BEGIN
 BEGIN UPDATE "BillingInvoiceCorrection" SET "amountRub"=-80; RAISE EXCEPTION 'correction was editable'; EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT "totalRub" FROM "BillingInvoice" WHERE id='i') <> 100 THEN RAISE EXCEPTION 'original amount changed'; END IF;
 IF (SELECT COUNT(*) FROM "BillingInvoiceItem" WHERE "invoiceId"='late') <> 1 THEN RAISE EXCEPTION 'late work was blocked'; END IF;
END $$;

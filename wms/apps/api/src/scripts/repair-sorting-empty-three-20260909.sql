-- FIX: explicit physical-zero confirmation by Konstantin, 2026-09-09. NOT a scheduled cleanup.
-- Run first with psql -v apply=false, inspect the rollback result, then -v apply=true.
-- All prior rows remain in the technical audit; no order/shipment history is removed.
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
LOCK TABLE "InventorySession" IN SHARE MODE;
DO $$
DECLARE
  ids text[] := ARRAY['b633b0b2-22c2-42cb-8877-e3a7d0546ddd','3c9caec3-97fa-4456-a1cc-f4164fa6bd6c','e8fbe621-15b5-481c-9e01-195cad9ff206'];
  session_id text := '90d53b46-bbbf-4189-a180-8765d0093c3a';
  audit_id text := 'sorting-confirmed-empty-three-20260909';
  before_state jsonb;
  source_count int;
BEGIN
  IF EXISTS(SELECT 1 FROM "AuditLog" WHERE id=audit_id) THEN RAISE NOTICE 'ALREADY_APPLIED'; RETURN; END IF;
  PERFORM id FROM "PalletSortingSession" WHERE id=session_id AND "completedAt" IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Completed sorting not found'; END IF;
  PERFORM id FROM "Box" WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
  PERFORM id FROM "StockBalance" WHERE "boxId"=ANY(ids) ORDER BY id FOR UPDATE;
  PERFORM id FROM "ProductMark" WHERE "boxId"=ANY(ids) ORDER BY id FOR UPDATE;
  PERFORM id FROM "FbsTsdAssembly" WHERE "boxId"=ANY(ids) OR "reservedBoxId"=ANY(ids) ORDER BY id FOR UPDATE;
  PERFORM id FROM "StoragePalletBox" WHERE "boxId"=ANY(ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM "Box" WHERE id=ANY(ids) AND status='active'
    AND "clientId"='c76b78f9-1b83-4e9b-bee3-bc28336ee1c9' AND "warehouseId"='afb244a1-50ae-4ae6-9111-afe85949fa58'
    AND code IN('FFL_LKB1807_256','FFL_LKB2107_246','FFL_LKB2107_44'))<>3 THEN RAISE EXCEPTION 'Box identity changed'; END IF;
  IF (SELECT count(*) FROM "StoragePalletBox" WHERE "boxId"=ANY(ids) AND "palletId"='9ae06393-d674-494b-b9b1-8dc960bf2445')<>3 THEN RAISE EXCEPTION 'Pallet placement changed'; END IF;
  IF EXISTS(SELECT 1 FROM "InventorySession" WHERE type='FULL' AND status IN('ACTIVE','REVIEW'))
    OR EXISTS(SELECT 1 FROM "InventoryAuditBox" WHERE "boxId"=ANY(ids) AND status IN('COUNTING','MISMATCH')) THEN RAISE EXCEPTION 'Inventory in progress'; END IF;
  IF EXISTS(SELECT 1 FROM "PalletSortingSession" s CROSS JOIN LATERAL jsonb_array_elements((s.state->'sources')||(s.state->'targets')) x
    WHERE s.id<>session_id AND s."completedAt" IS NULL AND x->>'id'=ANY(ids)) THEN RAISE EXCEPTION 'Another sorting claims these boxes'; END IF;
  IF EXISTS(SELECT 1 FROM "FbsTsdAssembly" WHERE ("boxId"=ANY(ids) OR "reservedBoxId"=ANY(ids))
    AND status NOT IN('COMPLETED','RETURN_REQUIRED','RELEASED','CANCELLED')) THEN RAISE EXCEPTION 'Active assembly requires route reconciliation first'; END IF;
  IF EXISTS(SELECT 1 FROM "ClientRequestBoxSelection" bs JOIN "ClientRequestItem" ri ON ri.id=bs."requestItemId"
    JOIN "ClientRequest" r ON r.id=ri."requestId" WHERE bs."boxId"=ANY(ids) AND r.status NOT IN('DONE','CANCELLED','REJECTED')
      AND NOT(bs.id='0ade9f55-3910-406c-b54c-7866daa4829a' AND bs.quantity=1 AND r.id='244c63af-d4c3-48bb-949f-fd5c3327f936' AND r.status='PACKED'
        AND EXISTS(SELECT 1 FROM "FbsTsdAssembly" t WHERE t."requestId"=r.id AND t."orderId"='5621053309' AND t.status='RETURN_REQUIRED' AND t."boxId"=bs."boxId"))) THEN RAISE EXCEPTION 'Active request selection'; END IF;
  IF (SELECT count(*) FROM "StockBalance" WHERE "boxId"=ANY(ids))<>4 OR EXISTS(
    SELECT 1 FROM "StockBalance" WHERE "boxId"=ANY(ids) AND NOT (
      status='PACKING' AND "clientId"='c76b78f9-1b83-4e9b-bee3-bc28336ee1c9' AND "warehouseId"='afb244a1-50ae-4ae6-9111-afe85949fa58' AND (
        id='efa10346-4084-4299-9f25-58b5cf1ce2f0' AND quantity=1 AND "updatedAt"='2026-08-25 13:50:10.315'::timestamp OR
        id='fc6f0412-b5bc-4dca-9c8a-badaa96f7910' AND quantity=2 AND "updatedAt"='2026-08-23 19:41:54.418'::timestamp OR
        id='65e8b811-4d1e-428f-bc3e-a86ec1f3ec4d' AND quantity=5 AND "updatedAt"='2026-08-31 15:33:35.055'::timestamp OR
        id='db67b617-1665-465e-87a3-f396eb0f2dd8' AND quantity=2 AND "updatedAt"='2026-08-31 15:33:35.690'::timestamp)))
    THEN RAISE EXCEPTION 'Balance snapshot changed'; END IF;
  IF EXISTS(SELECT 1 FROM "ProductMark" WHERE "boxId"=ANY(ids) AND "clientId"<>'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9') THEN RAISE EXCEPTION 'Foreign marks'; END IF;
  SELECT count(*) INTO source_count FROM "PalletSortingSession" s CROSS JOIN LATERAL jsonb_array_elements(s.state->'sources') x
    WHERE s.id=session_id AND x->>'id'=ANY(ids) AND x->>'archived'='false' AND x->>'preservedOnPallet'='true';
  IF source_count<>3 THEN RAISE EXCEPTION 'Sorting source state changed'; END IF;
  before_state=jsonb_build_object(
    'boxes',(SELECT jsonb_agg(to_jsonb(b)) FROM "Box" b WHERE b.id=ANY(ids)),
    'balances',(SELECT jsonb_agg(to_jsonb(b)) FROM "StockBalance" b WHERE b."boxId"=ANY(ids)),
    'marks',(SELECT jsonb_agg(to_jsonb(m)) FROM "ProductMark" m WHERE m."boxId"=ANY(ids)),
    'placements',(SELECT jsonb_agg(to_jsonb(p)) FROM "StoragePalletBox" p WHERE p."boxId"=ANY(ids)),
    'session',(SELECT to_jsonb(s) FROM "PalletSortingSession" s WHERE s.id=session_id),
    'assemblies',(SELECT jsonb_agg(to_jsonb(t)) FROM "FbsTsdAssembly" t WHERE t."boxId"=ANY(ids) OR t."reservedBoxId"=ANY(ids)));
  INSERT INTO "AuditLog"(id,action,entity,"entityId",payload,"createdAt") VALUES(audit_id,'ADMIN_CONFIRMED_EMPTY_SORTING_CORRECTION','PalletSortingSession',session_id,
    jsonb_build_object('authorizedBy','Константин: все три короба физически пустые','executor','Codex technical correction','before',before_state,'quantity',10,'saleAvailableDelta',0,'preserveReturnRequired',true),now());
  INSERT INTO "StockMovement"(id,"warehouseId","clientId","skuId","boxId","palletId",type,status,quantity,"sourceDocument","idempotencyKey",comment,"createdAt")
    SELECT gen_random_uuid()::text,"warehouseId","clientId","skuId","boxId","palletId",'INVENTORY_ADJUSTMENT',status,-quantity,audit_id,audit_id||':'||id,
      'Константин подтвердил физически пустой исходный короб после сортировки. Корректировка старого PACKING; история заказов и возвратов сохранена.',now()
      FROM "StockBalance" WHERE "boxId"=ANY(ids);
  UPDATE "StockBalance" SET quantity=0,"updatedAt"=now() WHERE "boxId"=ANY(ids);
  UPDATE "ProductMark" SET status='BLOCKED',"updatedAt"=now() WHERE "boxId"=ANY(ids) AND status IN('AVAILABLE','PACKING','RESERVED');
  UPDATE "Box" SET status='archived' WHERE id=ANY(ids);
  DELETE FROM "StoragePalletBox" WHERE "boxId"=ANY(ids);
  UPDATE "PalletSortingSession" s SET state=jsonb_set(jsonb_set(s.state,'{sources}',(
    SELECT jsonb_agg(CASE WHEN x->>'id'=ANY(ids) THEN (x-'retainedReason'-'preservedOnPallet')||'{"archived":true}'::jsonb ELSE x END ORDER BY n)
    FROM jsonb_array_elements(s.state->'sources') WITH ORDINALITY e(x,n))),'{version}',to_jsonb(s.version+1)),
    version=s.version+1,"updatedAt"=now() WHERE s.id=session_id;
  IF (SELECT sum(quantity) FROM "StockBalance" WHERE "boxId"=ANY(ids))<>0 OR EXISTS(SELECT 1 FROM "StoragePalletBox" WHERE "boxId"=ANY(ids)) THEN RAISE EXCEPTION 'Postcondition failed'; END IF;
  RAISE NOTICE 'VERIFIED: three archived boxes, ten PACKING corrected, no available receipt, order/shipment history preserved';
END $$;
SELECT code,status,(SELECT sum(quantity) FROM "StockBalance" WHERE "boxId"=b.id) quantity FROM "Box" b WHERE code IN('FFL_LKB1807_256','FFL_LKB2107_246','FFL_LKB2107_44') ORDER BY code;
\if :apply
COMMIT;
\else
ROLLBACK;
\endif

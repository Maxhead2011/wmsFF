const fs=require('node:fs'), assert=require('node:assert/strict');
const client='c76b78f9-1b83-4e9b-bee3-bc28336ee1c9', warehouse='afb244a1-50ae-4ae6-9111-afe85949fa58';
// FIX: explicit user scope is 0409 only. No other batch, empty box or archive is eligible.
function eligible(r) {
  return /^FFL_LKB0409_\d+$/.test(r.code) && r.clientId===client && r.warehouseId===warehouse &&
    r.status==='receiving' && r.balance>0 && r.receipts>0 && r.negative_balances===0 &&
    r.unmatched_receipts===0 && r.missing_movements===0 && r.failed_scans===0 &&
    Boolean(r.last_open) && r.last_open<=r.last_receipt && r.last_receipt<'2026-09-10T08:30:00';
}
function sql(rows) {
  const chosen=rows.filter(eligible);
  assert.equal(chosen.length,117,'snapshot changed; review the exact selection again');
  assert(chosen.some(r=>r.code==='FFL_LKB0409_546'&&r.balance===15));
  chosen.forEach(r=>assert.match(r.id,/^[0-9a-f-]{36}$/));
  const values=chosen.map(r=>`('${r.id}','${r.code}',${r.balance},${r.receipts},'${r.last_open}'::timestamp,'${r.last_receipt}'::timestamp)`).join(',\n');
  return `BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
CREATE TEMP TABLE selected(id text PRIMARY KEY,code text,balance int,receipts int,last_open timestamp,last_receipt timestamp) ON COMMIT DROP;
INSERT INTO selected VALUES ${values};
SELECT b.id FROM "Box" b JOIN selected s ON s.id=b.id ORDER BY b.id FOR UPDATE OF b;
SELECT sb.id FROM "StockBalance" sb JOIN selected s ON s.id=sb."boxId" ORDER BY sb.id FOR UPDATE OF sb;
DO $$ BEGIN
 IF (SELECT count(*) FROM "Box" b JOIN selected s ON s.id=b.id WHERE b.code=s.code AND b.status='receiving' AND b."clientId"='${client}' AND b."warehouseId"='${warehouse}')<>117 THEN RAISE EXCEPTION 'Box scope/status changed'; END IF;
 IF EXISTS(SELECT 1 FROM selected s WHERE
   (SELECT coalesce(sum(quantity),0) FROM "StockBalance" WHERE "boxId"=s.id)<>s.balance OR
   EXISTS(SELECT 1 FROM "StockBalance" WHERE "boxId"=s.id AND quantity<0) OR
   (SELECT count(*) FROM "StockMovement" WHERE "boxId"=s.id AND type='RECEIPT' AND quantity>0)<>s.receipts OR
   (SELECT max("createdAt") FROM "StockMovement" WHERE "boxId"=s.id AND type='RECEIPT' AND quantity>0) IS DISTINCT FROM s.last_receipt OR
   (SELECT max("createdAt") FROM "TsdOperation" WHERE "operationType"='receipt_open_box' AND payload->>'boxCode'=s.code AND payload->>'clientId'='${client}') IS DISTINCT FROM s.last_open OR
   EXISTS(SELECT 1 FROM "TsdOperation" WHERE "operationType"='receipt_scan' AND payload->>'boxCode'=s.code AND payload->>'clientId'='${client}' AND status<>'ACCEPTED') OR
   EXISTS(SELECT 1 FROM "StockMovement" m WHERE m."boxId"=s.id AND m.type='RECEIPT' AND m.quantity>0 AND NOT EXISTS(SELECT 1 FROM "TsdOperation" o WHERE o."operationKey"=m."idempotencyKey" AND o.status='ACCEPTED' AND o."operationType"='receipt_scan' AND o.payload->>'boxCode'=s.code AND o.payload->>'clientId'='${client}' AND o.payload->>'quantity'=m.quantity::text AND o.payload->>'sourceDocument'=m."sourceDocument")) OR
   EXISTS(SELECT 1 FROM "TsdOperation" o WHERE o."operationType"='receipt_scan' AND o.status='ACCEPTED' AND o.payload->>'boxCode'=s.code AND o.payload->>'clientId'='${client}' AND NOT EXISTS(SELECT 1 FROM "StockMovement" m WHERE m."boxId"=s.id AND m.type='RECEIPT' AND m."idempotencyKey"=o."operationKey"))
 ) THEN RAISE EXCEPTION 'Receipt proof or stock changed'; END IF;
END $$;
CREATE TEMP TABLE before_fingerprint ON COMMIT DROP AS SELECT
 (SELECT md5(string_agg(to_jsonb(x)::text,',' ORDER BY x.id)) FROM "StockBalance" x JOIN selected s ON s.id=x."boxId") balances,
 (SELECT md5(string_agg(to_jsonb(x)::text,',' ORDER BY x.id)) FROM "StockMovement" x JOIN selected s ON s.id=x."boxId") movements,
 (SELECT md5(string_agg(to_jsonb(x)::text,',' ORDER BY x.id)) FROM "ProductMark" x JOIN selected s ON s.id=x."boxId") marks;
UPDATE "Box" b SET status='active' FROM selected s WHERE b.id=s.id AND b.status='receiving';
INSERT INTO "TsdOperation"(id,"deviceId","operationKey","operationType",payload,status,"serverMessage","updatedAt")
 SELECT gen_random_uuid()::text,'SYSTEM:AUTHORIZED-0409-REPAIR','receipt-0409-close-20260910:'||s.id,'receipt_box_status',
 jsonb_build_object('clientId','${client}','warehouseId','${warehouse}','boxCode',s.code,'status','active','previousStatus','receiving','reason','Confirmed legacy TSD closed receipt batch; repair authorized by Konstantin','repairRun','receipt-0409-close-20260910','confirmedReceiptScans',s.receipts,'balanceUnchanged',s.balance),
 'ACCEPTED','Закрытие подтверждённой приёмки восстановлено. Остатки и КИЗы не изменены.',now() FROM selected s;
INSERT INTO "AuditLog"(id,action,entity,"entityId",payload)
 SELECT gen_random_uuid()::text,'RECEIPT_BOX_CLOSE_REPAIR','Box',s.id,jsonb_build_object('boxCode',s.code,'from','receiving','to','active','repairRun','receipt-0409-close-20260910','authorizedBy','Konstantin','stockUnchanged',true) FROM selected s;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM before_fingerprint f WHERE
 f.balances IS DISTINCT FROM (SELECT md5(string_agg(to_jsonb(x)::text,',' ORDER BY x.id)) FROM "StockBalance" x JOIN selected s ON s.id=x."boxId") OR
 f.movements IS DISTINCT FROM (SELECT md5(string_agg(to_jsonb(x)::text,',' ORDER BY x.id)) FROM "StockMovement" x JOIN selected s ON s.id=x."boxId") OR
 f.marks IS DISTINCT FROM (SELECT md5(string_agg(to_jsonb(x)::text,',' ORDER BY x.id)) FROM "ProductMark" x JOIN selected s ON s.id=x."boxId")
 ) THEN RAISE EXCEPTION 'Stock or marks changed concurrently'; END IF;
END $$;
SELECT json_build_object('boxes',count(*),'balance',sum(s.balance),'target546',max(s.balance) FILTER(WHERE s.code='FFL_LKB0409_546'),'status','active','stockUnchanged',true) FROM selected s;
COMMIT;
`;
}
module.exports={eligible,sql};
if(require.main===module){
 const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
 const output=sql(data.rows); fs.writeFileSync(process.argv[3],output);
 console.log(JSON.stringify({selected:data.rows.filter(eligible).length,batch:'0409',sql:process.argv[3]}));
}

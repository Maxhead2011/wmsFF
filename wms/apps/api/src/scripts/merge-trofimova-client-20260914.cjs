// FIX: one-off, fail-closed merge for OUR WMS only. No marketplace calls or stock recalculation.
const crypto = require('node:crypto');
const SOURCE = 'eee7b794-12f8-4b5e-9209-55e3b2ae6200';
const TARGET = '61be0b8b-6702-4dd5-91cc-cfeec676f944';
const OLD_CONNECTION = 'df5a51cf-e69b-4f0a-bd51-be0b72ac0ced';
const CONNECTION = '29bd3d2a-f6c8-4066-aa71-fc3b9335c7d5';
const ACTION = 'MERGE_TROFIMOVA_20260914';
const SKU_MAP = {
  '132c4509-ac08-47a9-9260-fb0c2ef4be66': '30d3e272-6854-472e-b455-90699abdfdd3',
  'b5be7d38-cdad-4ba0-ba27-ca7f584b716b': '219ebdf1-d2bb-4024-aaf1-536a29ba6801',
  'f998523f-0fc4-424b-96a2-c480640dbeef': 'f0cc370c-8b3f-4cd7-875f-e11277396b57',
};
const MAP = { [SOURCE]: TARGET, [OLD_CONNECTION]: CONNECTION, ...SKU_MAP };
// Only these three amount conflicts were confirmed by Konstantin. New differences stop the merge.
const APPROVED_AMOUNTS = {
  '0b51d3cb-e90e-4e58-924f-b46995fed0f7': ['2252a192-c2bd-4fba-a01e-35ebf3a366b1', '1902.13', '1881.38'],
  '472d3fe3-cd24-4fce-a0d6-1b008d7f2d62': ['ed8eb4b1-9e21-40b4-a84a-bd6a561ff442', '1902.13', '1922.87'],
  'd1a138dc-1bfc-4fd6-a1fc-ad895fb55e2b': ['be110f08-3eb4-492a-a8a0-ac0c8d73e2f7', '1860.64', '1902.13'],
};
// FIX: Konstantin confirmed keeping these two newly created invoices after the first safe abort.
const APPROVED_INVOICED_SOURCE = {
  'c17901be-c10d-4cd8-8cf8-856ba8381525': ['faa2c82f-b608-4a08-9230-4590212c094a', '306.38', '1902.13'],
  'a6332590-60af-47bf-b12f-b919df327276': ['21bcc500-0dcf-4053-9525-1c3f9788abe1', '264.89', '1860.64'],
};
const REFS = ['clientId', 'skuId', 'sourceSkuId', 'lastSkuId', 'connectionId', 'marketplaceConnectionId'];
const SPECIAL = ['Client','ClientMarketplaceConnection','Sku','Barcode','BillingCharge','BillingInvoiceItem',
  'ClientBillingService','ClientFbsBillingSettings','UserClient','WarehouseClient','FbsTsdAssembly',
  'FbsStockMonitorEvent','FbsStockMonitorHistory','FbsOrderRequestLink'];
const SIMPLE = ['BillingInvoice','ClientContract','ClientNotification','ClientRequest','ClientRequestEvent',
  'ClientRequestPackage','ClientRequestItem','ClientRequestPackageItem','FbsSupplyPlan','LogisticsDeliveryRequest','StockMovement'];
const ALLOWED = new Set([...SPECIAL, ...SIMPLE]);
const assert = (value, message) => { if (!value) throw new Error(message); };
const canonical = value => typeof value === 'string'
  ? Object.entries(MAP).reduce((text,[from,to])=>text.replaceAll(from,to),value) : value;
const canonicalJson = value => value == null ? value : JSON.parse(canonical(JSON.stringify(value)));
const rows = (snapshot,table) => snapshot[table] || [];
const key = (table,row) => row.id ? {id:row.id} : table === 'UserClient'
  ? {userId:row.userId,clientId:row.clientId} : {warehouseId:row.warehouseId,clientId:row.clientId};
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

// FIX: pure planner; tests cover the destructive decisions separately from DB execution.
function buildPlan(s) {
  const plan=[];
  const patch=(table,row,data)=>{ if(Object.keys(data).length)plan.push({op:'update',table,key:key(table,row),data}); };
  const remove=(table,row)=>plan.push({op:'delete',table,key:key(table,row)});
  const remap=(table,row,extra={})=>{
    const data={...extra};for(const field of REFS)if(MAP[row[field]])data[field]=MAP[row[field]];
    if(row.sourceKey && canonical(row.sourceKey)!==row.sourceKey)data.sourceKey=canonical(row.sourceKey);
    patch(table,row,data);
  };
  for(const [table,data] of Object.entries(s))assert(!data.length || ALLOWED.has(table),`Unreviewed references: ${table}`);
  const source=rows(s,'Client').find(r=>r.id===SOURCE),target=rows(s,'Client').find(r=>r.id===TARGET);
  assert(source?.code==='00-00000020' && source.status==='ARCHIVED','Source identity/status changed');
  assert(target?.code==='CL-000009' && target.status==='ACTIVE' && target.inn==='753504978331','Target identity changed');
  const oc=rows(s,'ClientMarketplaceConnection').find(r=>r.id===OLD_CONNECTION);
  const nc=rows(s,'ClientMarketplaceConnection').find(r=>r.id===CONNECTION);
  assert(oc?.clientId===SOURCE && nc?.clientId===TARGET && oc.marketplace===nc.marketplace && oc.apiKey && oc.apiKey===nc.apiKey,'Different marketplace accounts');
  assert(rows(s,'ClientMarketplaceConnection').length===2,'Unexpected connections');
  for(const [from,to] of Object.entries(SKU_MAP)) {
    const a=rows(s,'Sku').find(r=>r.id===from),b=rows(s,'Sku').find(r=>r.id===to);
    assert(a?.clientId===SOURCE && b?.clientId===TARGET,'SKU owner changed');
    for(const f of ['internalSku','article','name','size','color'])assert(a[f]===b[f],`SKU mismatch: ${f}`);
    for(const barcode of rows(s,'Barcode').filter(r=>r.skuId===from)) {
      assert(rows(s,'Barcode').some(r=>r.skuId===to && r.value===barcode.value),'Missing canonical barcode');
      remove('Barcode',barcode);
    }
  }
  assert(rows(s,'Sku').filter(r=>r.clientId===SOURCE).length===3,'Unexpected source SKUs');
  const charges=rows(s,'BillingCharge');
  for(const old of charges.filter(r=>r.clientId===SOURCE)) {
    const current=charges.find(r=>r.clientId===TARGET && old.sourceKey && r.sourceKey===canonical(old.sourceKey));
    if(!current){remap('BillingCharge',old,{metadata:canonicalJson(old.metadata)});continue;}
    assert(old.status==='DRAFT' && current.status==='DRAFT','Cannot deduplicate non-draft charges');
    const preserveInvoice=APPROVED_INVOICED_SOURCE[old.id];
    if(preserveInvoice){
      assert(preserveInvoice[0]===current.id && Number(preserveInvoice[1])===Number(old.totalRub)
        && [Number(preserveInvoice[1]),Number(preserveInvoice[2])].includes(Number(current.totalRub)),'Approved invoiced amounts changed');
      assert(rows(s,'BillingInvoiceItem').some(i=>i.chargeId===old.id),'Confirmed invoice missing');
      assert(!rows(s,'BillingInvoiceItem').some(i=>i.chargeId===current.id),'Both charges are invoiced');
      assert(!rows(s,'LogisticsDeliveryRequest').some(r=>r.billingChargeId===current.id),'Canonical charge has logistics dependency');
      remove('BillingCharge',current);
      remap('BillingCharge',old,{metadata:canonicalJson(old.metadata)});
      continue;
    }
    if(Number(old.totalRub)!==Number(current.totalRub)){
      const approved=APPROVED_AMOUNTS[old.id];
      assert(approved && approved[0]===current.id && Number(approved[1])===Number(old.totalRub) && Number(approved[2])===Number(current.totalRub),'Unapproved billing difference');
    }
    const oldItems=rows(s,'BillingInvoiceItem').filter(i=>i.chargeId===old.id);
    if(oldItems.length){
      assert(Number(old.totalRub)===Number(current.totalRub),'Invoiced amounts differ');
      assert(!rows(s,'BillingInvoiceItem').some(i=>i.chargeId===current.id),'Both charges are invoiced');
      for(const item of oldItems)patch('BillingInvoiceItem',item,{chargeId:current.id});
    }
    assert(!rows(s,'LogisticsDeliveryRequest').some(r=>r.billingChargeId===old.id),'Charge has logistics dependency');
    remove('BillingCharge',old);
  }
  // Keep actual/completed canonical tasks. Old copies may only be untouched queue placeholders.
  for(const old of rows(s,'FbsTsdAssembly').filter(r=>r.clientId===SOURCE)) {
    const current=rows(s,'FbsTsdAssembly').find(r=>r.clientId===TARGET && r.marketplace===old.marketplace && r.orderId===old.orderId);
    assert(current,'Unexpected unique source assembly');
    assert(['WAITING_STOCK','RELEASED'].includes(old.status),'Source task is active');
    for(const f of ['kiz','completedAt','startedAt','reservedBoxId','boxId','marketplaceSubmittedAt','cargoPackingId'])assert(!old[f],`Source task has physical evidence: ${f}`);
    remove('FbsTsdAssembly',old);
  }
  for(const old of rows(s,'FbsOrderRequestLink').filter(r=>r.clientId===SOURCE)) {
    const current=rows(s,'FbsOrderRequestLink').find(r=>r.clientId===TARGET && r.marketplace===old.marketplace && r.orderId===old.orderId);
    if(current){
      assert(rows(s,'ClientRequest').some(r=>r.id===old.requestId && r.status==='CANCELLED'),'Duplicate order is in non-cancelled request');
      remove('FbsOrderRequestLink',old);
    } else remap('FbsOrderRequestLink',old);
  }
  for(const old of rows(s,'FbsStockMonitorEvent').filter(r=>r.clientId===SOURCE)) {
    const current=rows(s,'FbsStockMonitorEvent').find(r=>r.clientId===TARGET && r.eventKey===canonical(old.eventKey));
    assert(!old.processingAt,'Monitor check currently running');
    if(current){
      for(const history of rows(s,'FbsStockMonitorHistory').filter(r=>r.eventId===old.id))patch('FbsStockMonitorHistory',history,{eventId:current.id});
      remove('FbsStockMonitorEvent',old);
    } else remap('FbsStockMonitorEvent',old,{eventKey:canonical(old.eventKey),sourceIds:canonicalJson(old.sourceIds)});
  }
  for(const old of rows(s,'ClientBillingService').filter(r=>r.clientId===SOURCE)) {
    const current=rows(s,'ClientBillingService').find(r=>r.clientId===TARGET && r.serviceId===old.serviceId);
    assert(current,'Unreviewed tariff');
    for(const f of Object.keys(old).filter(f=>!['id','clientId','createdAt','updatedAt','updatedByUserId'].includes(f)))assert(same(old[f],current[f]),`Tariff differs: ${f}`);
    remove('ClientBillingService',old);
  }
  const settings=rows(s,'ClientFbsBillingSettings'),a=settings.find(r=>r.clientId===SOURCE),b=settings.find(r=>r.clientId===TARGET);
  assert(a && b,'Missing billing settings');
  for(const f of Object.keys(a).filter(f=>!['id','clientId','createdAt','updatedAt'].includes(f)))assert(same(a[f],b[f]),`Billing settings differ: ${f}`);
  remove('ClientFbsBillingSettings',a);
  for(const table of ['UserClient','WarehouseClient'])for(const old of rows(s,table).filter(r=>r.clientId===SOURCE)){
    const f=table==='UserClient'?'userId':'warehouseId';const current=rows(s,table).find(r=>r.clientId===TARGET && r[f]===old[f]);
    if(current){
      if(table==='UserClient')assert(old.canRead===current.canRead && old.canWrite===current.canWrite,'Access rights differ');
      remove(table,old);
    }else remap(table,old);
  }
  for(const table of SIMPLE)for(const row of rows(s,table))remap(table,row);
  for(const from of Object.keys(SKU_MAP))remove('Sku',rows(s,'Sku').find(r=>r.id===from));
  remove('ClientMarketplaceConnection',oc);
  remove('Client',source);
  return plan;
}

function summary(plan){const result={};for(const p of plan){const k=p.op+':'+p.table;result[k]=(result[k]||0)+1;}return result;}
function ident(value){assert(/^[A-Za-z][A-Za-z0-9_]*$/.test(value),'Invalid SQL identifier');return '"'+value+'"';}
async function referenceColumns(tx) {
  return tx.$queryRawUnsafe(`SELECT table_name AS t,column_name AS c FROM information_schema.columns
    WHERE table_schema='public' AND data_type IN ('text','character varying')
    AND (column_name ILIKE '%clientId' OR column_name ILIKE '%skuId' OR column_name ILIKE '%connectionId' OR column_name ILIKE '%assemblyId') ORDER BY 1,2`);
}
async function snapshot(tx) {
  const columns=await referenceColumns(tx),s={};
  const oldTasks=await tx.$queryRawUnsafe('SELECT id FROM "FbsTsdAssembly" WHERE "clientId"=$1',SOURCE);
  const ids=[...Object.keys(MAP),...Object.values(MAP),...oldTasks.map(r=>r.id)];
  const tables=new Set(columns.map(c=>c.t));
  for(const table of tables) {
    const where=columns.filter(c=>c.t===table).map(c=>`${ident(c.c)}=ANY($1::text[])`).join(' OR ');
    const data=await tx.$queryRawUnsafe(`SELECT to_jsonb(t) - 'pdfData' - 'signedPdfData' AS row FROM ${ident(table)} t WHERE ${where}`,ids);
    // Canonical-only unrelated records need no rewrite, but canonical pairs are needed for conflict checks.
    const relevant=data.map(d=>d.row).filter(r=>ALLOWED.has(table) || Object.values(r).some(v=>Object.keys(MAP).includes(v) || oldTasks.some(a=>a.id===v)));
    if(relevant.length)s[table]=relevant;
  }
  s.Client=(await tx.$queryRawUnsafe('SELECT to_jsonb(t) AS row FROM "Client" t WHERE id=ANY($1::text[])',[SOURCE,TARGET])).map(r=>r.row);
  const chargeIds=rows(s,'BillingCharge').map(r=>r.id),eventIds=rows(s,'FbsStockMonitorEvent').map(r=>r.id);
  s.BillingInvoiceItem=(await tx.$queryRawUnsafe('SELECT to_jsonb(t) AS row FROM "BillingInvoiceItem" t WHERE "chargeId"=ANY($1::text[])',chargeIds)).map(r=>r.row);
  s.FbsStockMonitorHistory=(await tx.$queryRawUnsafe('SELECT to_jsonb(t) AS row FROM "FbsStockMonitorHistory" t WHERE "eventId"=ANY($1::text[])',eventIds)).map(r=>r.row);
  const extra=await tx.$queryRawUnsafe('SELECT count(*)::int n FROM "ClientFbsAdditionalService" WHERE "settingsId" IN (SELECT id FROM "ClientFbsBillingSettings" WHERE "clientId"=$1)',SOURCE);
  assert(extra[0].n===0,'Unreviewed additional billing services');
  return s;
}
async function executePlan(tx,plan) {
  for(const p of plan){
    const values=Object.values(p.key),where=Object.keys(p.key).map((k,i)=>`${ident(k)}=$${i+1}`).join(' AND ');
    const sql=p.op==='delete'?`DELETE FROM ${ident(p.table)} WHERE ${where}`
      :`UPDATE ${ident(p.table)} SET ${Object.keys(p.data).map(k=>`${ident(k)}=(jsonb_populate_record(NULL::${ident(p.table)},$${values.length+1}::jsonb)).${ident(k)}`).join(',')} WHERE ${where}`;
    if(p.op==='update')values.push(JSON.stringify(p.data));
    assert(await tx.$executeRawUnsafe(sql,...values)===1,`Concurrent change: ${p.table}`);
  }
}
async function fingerprint(tx,table,fields,where='TRUE',params=[]) {
  const result=await tx.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(v::text,'' ORDER BY v::text),'')) AS hash FROM (SELECT jsonb_build_array(${fields.map(ident).join(',')}) v FROM ${ident(table)} WHERE ${where}) q`,...params);
  return result[0].hash;
}
async function invariants(tx){return {
  balances:await fingerprint(tx,'StockBalance',['id','skuId','quantity','status','warehouseId','boxId']),
  ledger:await fingerprint(tx,'StockMovement',['id','quantity','status','type','warehouseId','boxId','idempotencyKey']),
  invoices:await fingerprint(tx,'BillingInvoice',['id','number','totalRub','paidRub','status']),
  invoiceItems:await fingerprint(tx,'BillingInvoiceItem',['id','invoiceId','quantity','unitPriceRub','totalRub']),
  tasks:await fingerprint(tx,'FbsTsdAssembly',['id','status','requestId','requestItemId','kiz','reservedBoxId','boxId','completedAt','workerUserId'],'"clientId"=$1',[TARGET]),
  requests:await fingerprint(tx,'ClientRequest',['id','number','warehouseId','status']),
};}
function validateApplyGate(s,drained){
  assert(rows(s,'ClientMarketplaceConnection').find(r=>r.id===OLD_CONNECTION)?.isActive===false,'Disable and drain the old WB connection first');
  assert(drained===OLD_CONNECTION,'Old connection drain confirmation required');
}
async function merge(db,{mode='preview',actorId,backupSha}={}) {
  assert(['preview','rehearse','apply'].includes(mode),'Invalid mode');
  return db.$transaction(async tx=>{
    if(mode==='preview')await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    else {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout='2s'");
      const locked=await tx.$queryRawUnsafe('SELECT pg_try_advisory_xact_lock(20260914,901) locked');
      assert(locked[0].locked,'Merge already running');
      // Short fail-fast write exclusion; reads remain available. No global application restart.
      const tables=[...ALLOWED,'ClientFbsAdditionalService','StockBalance','AuditLog'].sort();
      await tx.$executeRawUnsafe(`LOCK TABLE ${tables.map(ident).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
    }
    const done=await tx.$queryRawUnsafe('SELECT id FROM "AuditLog" WHERE action=$1 AND "entityId"=$2',ACTION,TARGET);
    if(done.length)return {alreadyApplied:true};
    const s=await snapshot(tx),plan=buildPlan(s),counts=summary(plan);
    if(mode==='preview')return {mode,counts};
    // FIX: a preloaded background WB response must not recreate the duplicate after commit.
    // The runbook requires disabling ONLY the old connection and draining in-flight work first.
    if(mode==='apply')validateApplyGate(s,process.env.WMS_MERGE_OLD_CONNECTION_DRAINED);
    const actor=await tx.user.findUnique({where:{id:actorId},select:{status:true,roles:{select:{role:{select:{code:true}}}}}});
    assert(actor?.status==='ACTIVE' && actor.roles.some(r=>r.role.code==='ADMIN'),'Verified administrator actor required');
    assert(/^[a-f0-9]{64}$/.test(backupSha||''),'Verified backup SHA256 required');
    const before=await invariants(tx);
    await executePlan(tx,plan);
    const after=await invariants(tx);
    assert(same(before,after),'Invariant failed: stock/invoice/task/request changed');
    for(const {t,c} of await referenceColumns(tx)){
      const result=await tx.$queryRawUnsafe(`SELECT count(*)::int n FROM ${ident(t)} WHERE ${ident(c)}=ANY($1::text[])`,Object.keys(MAP));
      assert(result[0].n===0,`Dangling source references: ${t}.${c}`);
    }
    await tx.auditLog.create({data:{id:crypto.randomUUID(),userId:actorId,action:ACTION,entity:'Client',entityId:TARGET,
      payload:{sourceId:SOURCE,targetId:TARGET,backupSha,counts,skuMap:SKU_MAP,connectionMap:{[OLD_CONNECTION]:CONNECTION},approvedAmounts:APPROVED_AMOUNTS,approvedInvoicedSource:APPROVED_INVOICED_SOURCE,
        deletedRecords:plan.filter(p=>p.op==='delete').map(p=>({table:p.table,...p.key})),invariants:after}}});
    return {mode,counts,invariants:after};
  },{isolationLevel:'Serializable',timeout:120000,maxWait:5000});
}

if(require.main===module){
  (async()=>{
    const mode=process.argv.includes('--apply')?'apply':process.argv.includes('--rehearse')?'rehearse':'preview';
    assert(mode!=='apply' || process.env.WMS_OUR_VM_CLIENT_MERGE==='CL-000009','OUR WMS apply gate required');
    const url=new URL(process.env.DATABASE_URL);
    if(mode==='rehearse')url.pathname='/wms_trofimova_rehearsal_20260914';
    const {PrismaClient}=require(process.env.WMS_PRISMA_MODULE || '@prisma/client');
    const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
    try{console.log(JSON.stringify(await merge(db,{mode,actorId:process.env.WMS_MERGE_ACTOR_ID,backupSha:process.env.WMS_MERGE_BACKUP_SHA256}),null,2));}
    finally{await db.$disconnect();}
  })().catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={buildPlan,summary,merge,canonical,canonicalJson,validateApplyGate,SOURCE,TARGET,OLD_CONNECTION,CONNECTION,SKU_MAP,ACTION};

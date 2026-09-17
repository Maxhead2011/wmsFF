const crypto = require('node:crypto');
const CLIENT = '1757a389-c0d4-49b5-9347-2bde0c549260';
const WAREHOUSE = 'afb244a1-50ae-4ae6-9111-afe85949fa58';
const OPERATION = 'bushkova-primary-exact-dedup-20260917-v1';
const ACTION = 'billing.primary.exactDuplicateCorrection';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cents = value => Math.round(Number(value) * 100);
const day = value => new Date(value).toISOString().slice(0, 10);
const inPeriod = value => day(value) >= '2026-08-01' && day(value) <= '2026-09-15';
const activeItems = c => c.invoiceItems.filter(i => i.invoice.status !== 'CANCELLED');
const orders = c => [...new Set(c.metadata?.orderIds ?? [])].sort();
const source = c => /^(fbs-primary:[^:]+):(WILDBERRIES|OZON):([^:]+):(date|supply):/.exec(c.sourceKey ?? '');

// FIX: operation-specific, fail-closed proof; no approximate matching or tariff recalculation.
function buildPlan(snapshot) {
  if (snapshot.clientId !== CLIENT || !snapshot.lifecycleEnabled || !Array.isArray(snapshot.repeatOrderIds)) throw Error('Scope/lifecycle evidence missing');
  const repeats = new Set(snapshot.repeatOrderIds);
  const eligible = c => c.clientId === CLIENT && c.status !== 'CANCELLED' && c.serviceId &&
    c.metadata?.kind === 'FBS_PRIMARY_PROCESSING' && source(c)?.[1] === `fbs-primary:${CLIENT}` && inPeriod(c.serviceDate) &&
    orders(c).length > 0 && orders(c).every(id => typeof id === 'string' && id && !repeats.has(id)) &&
    Number(c.quantity) > 0 && cents(c.totalRub) > 0 && activeItems(c).length === 1 &&
    activeItems(c).every(i => i.invoice.clientId === CLIENT && (i.invoice.warehouseId ?? i.invoice.request?.warehouseId) === WAREHOUSE &&
      inPeriod(i.invoice.periodFrom) && inPeriod(i.invoice.periodTo) && i.chargeId === c.id && i.unit === c.unit &&
      Number(i.quantity) === Number(c.quantity) && cents(i.unitPriceRub) === cents(c.unitPriceRub) && cents(i.totalRub) === cents(c.totalRub));
  const exact = (a,b) => source(a)[2] === source(b)[2] && source(a)[3] === source(b)[3] &&
    a.serviceId === b.serviceId && a.unit === b.unit && JSON.stringify(orders(a)) === JSON.stringify(orders(b)) &&
    Number(a.quantity) === Number(b.quantity) && cents(a.unitPriceRub) === cents(b.unitPriceRub) && cents(a.totalRub) === cents(b.totalRub) &&
    a.metadata.taxMode === b.metadata.taxMode && a.metadata.priceBeforeTaxRub != null && b.metadata.priceBeforeTaxRub != null &&
    Number(a.metadata.priceBeforeTaxRub) === Number(b.metadata.priceBeforeTaxRub) &&
    (a.metadata.billingAttemptId ?? null) === (b.metadata.billingAttemptId ?? null);
  const safe = snapshot.charges.filter(eligible);
  let corrections = [];
  for (const c of safe.filter(c => c.status === 'DRAFT' && source(c)[4] === 'date')) {
    const keepers = safe.filter(b => source(b)[4] === 'supply' && exact(c,b));
    if (keepers.length !== 1) continue;
    const item = activeItems(c)[0], inv = item.invoice;
    if (inv.status !== 'DRAFT' || Number(inv.paidRub) !== 0 || inv.payments.length ||
      inv.items.reduce((sum,i) => sum+cents(i.totalRub),0) !== cents(inv.totalRub) ||
      inv.items.some(i => cents(i.totalRub) < 0) || !inv.items.some(i=>i.id===item.id)) continue;
    corrections.push({ removeChargeId:c.id, keepChargeId:keepers[0].id, invoiceId:inv.id, invoiceNumber:inv.number,
      itemId:item.id, orderIds:orders(c), removedRub:cents(item.totalRub)/100 });
  }
  // FIX: cancel only wholly duplicated drafts. Never delete/rewrite item history or split mixed invoices.
  corrections = corrections.filter(c=>{
    const original = safe.flatMap(c=>activeItems(c)).find(i=>i.invoice.id===c.invoiceId).invoice;
    const removedIds = new Set(corrections.filter(x=>x.invoiceId===c.invoiceId).map(x=>x.itemId));
    return original.items.every(i=>removedIds.has(i.id));
  });
  const invoices = [...new Set(corrections.map(c=>c.invoiceId))].map(id=>{
    const original = safe.flatMap(c=>activeItems(c)).find(i=>i.invoice.id===id).invoice;
    const removedIds = new Set(corrections.filter(c=>c.invoiceId===id).map(c=>c.itemId));
    return {id, number:original.number, beforeTotalRub:cents(original.totalRub)/100,
      afterTotalRub:cents(original.totalRub)/100, afterActiveRub:0, afterStatus:'CANCELLED', retainedItemIds:[...removedIds]};
  });
  return { corrections, invoices, decreaseRub:corrections.reduce((n,c)=>n+cents(c.removedRub),0)/100,
    fingerprint:hash({clientId:snapshot.clientId,lifecycleEnabled:snapshot.lifecycleEnabled,charges:snapshot.charges,repeatOrderIds:snapshot.repeatOrderIds}) };
}

async function load(tx) {
  const charges = await tx.billingCharge.findMany({where:{clientId:CLIENT,metadata:{path:['kind'],equals:'FBS_PRIMARY_PROCESSING'}},
    include:{request:{select:{warehouseId:true,number:true}},service:{select:{code:true}},invoiceItems:{orderBy:{id:'asc'},include:{invoice:{include:{payments:{select:{id:true,status:true,amountRub:true},orderBy:{id:'asc'}},items:{orderBy:{id:'asc'}},request:{select:{warehouseId:true}}}}}}},orderBy:{id:'asc'}});
  const repeats = await tx.fbsAssemblyAttemptHistory.findMany({where:{clientId:CLIENT},select:{orderId:true},orderBy:{id:'asc'}});
  return {clientId:CLIENT,lifecycleEnabled:process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED==='true',charges,repeatOrderIds:[...new Set(repeats.map(x=>x.orderId))].sort()};
}

// FIX: scoped financial repair, optimistic snapshot plus the existing shared billing lock.
async function execute(prisma, mode, expectedHash) {
  const rehearsal = { marker:'rehearsal rollback' };
  try {
    return await prisma.$transaction(async tx=>{
      if(mode==='preview') {await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); const snapshot=await load(tx);return {mode,plan:buildPlan(snapshot)};}
      if(!['rehearse','apply'].includes(mode) || !/^[a-f0-9]{64}$/.test(expectedHash??''))throw Error('Explicit mode and reviewed fingerprint required');
      await tx.$queryRawUnsafe('SELECT 1 AS locked FROM pg_advisory_xact_lock(1464685395,1179209294)');
      const replay=await tx.auditLog.findFirst({where:{action:ACTION,entityId:OPERATION}});
      if(replay)return {mode,replayed:true,result:replay.payload.result};
      await tx.$queryRawUnsafe('SELECT id FROM "BillingInvoice" WHERE "clientId"=$1 ORDER BY id FOR UPDATE',CLIENT);
      await tx.$queryRawUnsafe('SELECT id FROM "BillingCharge" WHERE "clientId"=$1 ORDER BY id FOR UPDATE',CLIENT);
      const snapshot=await load(tx), plan=buildPlan(snapshot);
      if(plan.fingerprint!==expectedHash)throw Error('Financial snapshot changed; repeat preview');
      if(!plan.corrections.length)throw Error('No proven duplicate to correct');
      for(const c of plan.corrections){
        const changed=await tx.billingCharge.updateMany({where:{id:c.removeChargeId,clientId:CLIENT,status:'DRAFT'},data:{status:'CANCELLED',comment:`${OPERATION}: повтор начисления ${c.keepChargeId}; сохранено в истории.`}});
        if(changed.count!==1)throw Error('Charge guard failed');
      }
      for(const i of plan.invoices){
        const changed=await tx.billingInvoice.updateMany({where:{id:i.id,clientId:CLIENT,status:'DRAFT',paidRub:0,payments:{none:{}}},data:{status:i.afterStatus}});
        if(changed.count!==1)throw Error('Invoice guard failed');
        const items=await tx.billingInvoiceItem.findMany({where:{invoiceId:i.id},select:{totalRub:true}});
        if(items.reduce((s,i)=>s+cents(i.totalRub),0)!==cents(i.afterTotalRub))throw Error('Total invariant failed');
      }
      const after=await load(tx);
      if(buildPlan(after).corrections.length)throw Error('Duplicate correction is not idempotent');
      const beforeById=new Map(snapshot.charges.map(c=>[c.id,JSON.stringify(c)]));
      const affectedInvoices=new Set(plan.invoices.map(i=>i.id));
      const affectedCharges=new Set(plan.corrections.map(c=>c.removeChargeId));
      for(const c of after.charges)if(!affectedCharges.has(c.id)&&!c.invoiceItems.some(i=>affectedInvoices.has(i.invoice.id))&&beforeById.get(c.id)!==JSON.stringify(c))throw Error('Unrelated primary charge changed');
      const result={correctedCharges:plan.corrections.length,changedDrafts:plan.invoices.length,decreaseRub:plan.decreaseRub,invoices:plan.invoices};
      await tx.auditLog.create({data:{action:ACTION,entity:'BillingInvoice',entityId:OPERATION,payload:JSON.parse(JSON.stringify({authorizedBy:'Константин, explicit request in Codex',reason:'Exact date/supply duplicate; no repricing',result,plan,before:snapshot.charges.filter(c=>affectedCharges.has(c.id)||c.invoiceItems.some(i=>affectedInvoices.has(i.invoice.id)))}))}});
      if(mode==='rehearse'){rehearsal.result=result;throw rehearsal;}
      return {mode,replayed:false,result};
    },{isolationLevel:'Serializable',timeout:60000,maxWait:10000});
  } catch(e) {if(e===rehearsal)return {mode,rolledBack:true,result:rehearsal.result};throw e;}
}
module.exports = { buildPlan, execute, CLIENT, WAREHOUSE, OPERATION };
if(require.main===module){
  const {PrismaClient}=require(process.env.PRISMA_MODULE || '../node_modules/@prisma/client');
  const prisma=new PrismaClient();
  execute(prisma,process.argv[2]??'preview',process.argv[3]).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
}

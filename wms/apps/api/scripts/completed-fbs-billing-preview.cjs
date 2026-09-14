// FIX: production preflight only. PostgreSQL READ ONLY prevents any financial mutation.
const { createRequire } = require('node:module');
const appRequire = createRequire('/app/apps/api/package.json');
const { PrismaClient } = appRequire('@prisma/client');
const { recoverCompletedWork } = require(process.argv[2] || '/app/apps/api/dist/modules/billing/completed-fbs-billing.js');
const clientId = 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9';
process.env.WMS_FBS_COMPLETED_WORK_BILLING_ENABLED = 'true';
process.env.WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED = 'true';
const db = new PrismaClient();
(async () => {
  const { plan, unattached } = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const plan = await recoverCompletedWork(tx, clientId, { preview: true });
    const ids = [...new Set(plan.blocked.filter(x => x.reason === 'CHARGE_WITHOUT_ACTIVE_INVOICE').map(x => x.chargeId))];
    const unattached = await tx.billingCharge.findMany({ where: { clientId, id: { in: ids } },
      select: { id: true, status: true, requestId: true, quantity: true, totalRub: true, serviceDate: true,
        request: { select: { number: true, warehouseId: true } },
        invoiceItems: { select: { invoice: { select: { number: true, status: true, comment: true, paidRub: true } } } } } });
    return { plan, unattached };
  }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
  const serviceTotals = {};
  for (const line of plan.lines.filter(x => !x.existingChargeId)) {
    const row = serviceTotals[line.service] ||= { orders: 0, units: 0, totalRub: 0 };
    row.orders++; row.units += line.quantity; row.totalRub = Math.round((row.totalRub + line.totalRub) * 100) / 100;
  }
  const blocked = {};
  for (const row of plan.blocked) blocked[row.reason] = (blocked[row.reason] || 0) + 1;
  const requests = new Map();
  for (const line of plan.lines.filter(x => x.service === 'processing' && !x.existingChargeId)) {
    requests.set(line.requestId, (requests.get(line.requestId) || 0) + line.quantity);
  }
  console.log(JSON.stringify({ preview: true, writes: 0, clientId, checkedAt: new Date().toISOString(),
    serviceTotals, newTotalRub: Math.round(plan.lines.filter(x => !x.existingChargeId).reduce((sum, line) => sum + line.totalRub, 0) * 100) / 100,
    attachments: plan.lines.filter(x => x.existingChargeId).map(x => ({ chargeId: x.existingChargeId, quantity: x.quantity,
      orderCount: x.metadata.orderIds?.length, totalRub: x.totalRub, serviceDate: x.serviceDate, warehouseId: x.warehouseId })),
    blocked, unattached, blockedSamples: plan.blocked.slice(0, 5), requestCount: requests.size,
    largestRequests: [...requests].sort((a, b) => b[1] - a[1]).slice(0, 15) }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());

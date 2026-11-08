// TEST: baseline enters the shipping path; the fixed ACK never does so.
const assert = require('node:assert/strict');
const { MarketplaceConnectionsService } = require('/app/apps/api/dist/modules/marketplace-connections/marketplace-connections.service');
process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED = 'true';
const service = Object.create(MarketplaceConnectionsService.prototype);
const job = { id: 'synthetic', source: 'SOS_POST_PICK', deviceCode: 'SOS-WB:old', assemblyId: 'synthetic', status: 'PRINTED' };
service.prisma = { fbsPrintJob: { updateMany: async () => {}, findUniqueOrThrow: async () => job }, auditLog: { create: async () => {} } };
(async () => {
  let failed = false;
  try { await service.finishFbsPrintJob(job.id, true, null, { id: 'synthetic' }); }
  catch (e) { failed = true; assert(e instanceof TypeError); }
  assert.equal(failed, process.argv[2] === 'red');
  console.log(process.argv[2] + ': ACK regression verified without stock delegates');
})().catch(e => { console.error(e); process.exit(1); });

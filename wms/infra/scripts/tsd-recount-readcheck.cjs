// TEST: production database transaction is read-only; no real stock or WB operation.
const assert=require('node:assert/strict');
const {PrismaClient}=require('/app/apps/api/node_modules/@prisma/client');
const {physicalStockRecoveryEnabled}=require('/app/apps/api/dist/modules/stock/tsd-physical-stock-reconciliation');
const {requireAdminRecount}=require('/app/apps/api/dist/modules/marketplace-connections/tsd-admin-recount-release');
const {permanentStorageBoxesEnabled}=require('/app/apps/api/dist/common/boxes/box-code-policy.service');
const {INTERNAL_API_DEFINITIONS}=require('/app/apps/api/dist/modules/administration/administration-internal-api.service');
const db=new PrismaClient();
db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  await tx.$queryRawUnsafe('SELECT 1');
  assert(physicalStockRecoveryEnabled()); assert(permanentStorageBoxesEnabled());
  assert.equal(process.env.WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED,'true');
  assert.equal(INTERNAL_API_DEFINITIONS.find(x=>x.id==='tsd').routeCount,86);
  requireAdminRecount({roleCodes:['ADMIN'],permissionCodes:[]},true);
  assert.throws(()=>requireAdminRecount({roleCodes:['CLIENT'],permissionCodes:['system:admin']},true));
  return {status:'PASS',databaseReadOnly:true,recountEnabled:true,clientDenied:true,previousFlagsPreserved:true,tsdHandlers:86};
}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());

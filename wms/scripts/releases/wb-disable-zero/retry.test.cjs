/* TEST: retry an explicit OFF even when the cached WB amount was zero and an older
   in-flight PUT finishes late. No network calls or production stock changes. */
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(process.argv[2], 'modules/marketplace-connections');
const { saveWbPublicationChoices } = require(path.join(root, 'wb-disable-verification'));
const { WbStockSyncWorker } = require(path.join(root, 'wb-stock-sync-queue'));
const { publishWbStockPlan } = require(path.join(root, 'wb-stock-safe-publication'));
process.env.WMS_WB_URGENT_STOCK_SYNC = 'true';
const managed = ['1693195','1935300','1935323','1935327','1935331','1954106','1954119'];
const outside = '2067026', size = 1735404697;
const balances = new Map([...managed.map(id => [id, 0]), [outside, 8]]);
let pending = false, busy = true;
const phases = [];
const db = {
  $queryRaw: async sql => sql.join('').includes('SELECT id,') ? [{ id: 1n, skuIds: ['sku'] }] : [{ clientId: 'lukin', attempts: 0 }],
  $executeRaw: async sql => {
    if (sql.join('').includes('INSERT INTO "WbStockSyncEvent"')) pending = true;
    if (sql.join('').includes('SET "processedAt"')) pending = false;
    return 1;
  },
  $transaction: async ops => typeof ops === 'function' ? ops(db) : Promise.all(ops),
  auditLog: { create: async x => phases.push(x.data.payload.phase) },
  fbsStockAllocationPolicy: { updateMany: async () => ({count:1}) },
};
(async () => {
  await saveWbPublicationChoices(db,[Promise.resolve({enabled:false})],'lukin',['sku'],false,false);
  assert(pending);
  const retry = () => new WbStockSyncWorker(db, async () => {
    if (busy) throw Error('account sync busy');
    await publishWbStockPlan(managed.map(warehouseId => ({warehouseId,chrtId:size,skuId:'sku',amount:0})), {
      record: async () => {},
      read: async warehouse => new Map([[size,balances.get(warehouse)]]),
      send: async (warehouse, rows) => { assert(managed.includes(warehouse)); balances.set(warehouse,rows[0].amount); },
    });
  }, () => {}).tick();
  await retry();assert(pending);assert(phases.includes('RETRY_REQUIRED'));
  balances.set(managed[0],3); busy=false;
  await retry();assert(!pending);assert(phases.includes('PROCESSED'));
  assert(managed.every(id => balances.get(id)===0));assert.equal(balances.get(outside),8);
  console.log('Busy account retried after restart; seven verified zeroes, outside warehouse preserved.');
})().catch(e=>{console.error(e);process.exitCode=1});

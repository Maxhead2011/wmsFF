// TEST: execute the actual published/candidate display entry point with bounded adapters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const runtime = path.resolve(process.env.FBS_RUNTIME);
const source = fs.readFileSync(runtime, 'utf8');
const method = source.slice(source.indexOf('    async listFbsOrdersForDisplay('), source.indexOf('    async listFbsOrders(', source.indexOf('    async listFbsOrdersForDisplay(')));
const mergeStart = source.indexOf('    mergeIncrementalFbsOrders(previous, refreshed)');
const merge = source.slice(mergeStart, source.indexOf('    // ADDED:', mergeStart));
function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end);
}
function row(id = '6288167909', connectionId = 'cabinet') {
  return { id, connectionId, marketplace: 'WILDBERRIES', category: 'active', supplierStatus: 'new', wbStatus: 'waiting', statusLabel: 'Новый', storageBoxes: ['box'], request: null };
}
function response(orders) {
  return { orders, connections: [], fetchedAt: '2026-11-17T12:00:00Z', counts: { active: orders.length, all: orders.length } };
}
async function run(previous, fresh, statusReader) {
  let pending;
  let state = { value: previous, pending: false };
  const calls = [];
  const Service = vm.runInNewContext(`class Service {${method}${merge}}; ${declaration('fbsOrderCategory')} ${declaration('fbsStatusLabel')}; Service`, {
    require(name) {
      if (name.includes('fbs-client-visibility')) return { assertFbsClientVisible: async () => {} };
      return require(path.join(path.dirname(runtime), name));
    },
    wildberries_request_scheduler_1: { runWithWildberriesRequestPriority: (_, fn) => fn() },
    FBS_ORDERS_CACHE_TTL_MS: Infinity,
    selectionKey: (connection, id) => `${connection}:${id}`,
    marketplaceJson: async (_, options) => {
      const ids = JSON.parse(options.body).orders;
      calls.push(ids);
      return { orders: await statusReader(ids, options.headers.Authorization) };
    },
    asArray: value => Array.isArray(value) ? value : [],
  });
  const service = new Service();
  service.clientScopes = { requireClientAccess() {} };
  service.fbsOrdersCache = new Map([['client', { value: previous }]]);
  service.fbsDisplayCache = {
    get: () => state,
    refresh: (_, fn) => {
      pending = fn().then(value => { state = { value }; }, error => { state = { ...state, error: error.message }; });
    },
  };
  service.prisma = { clientMarketplaceConnection: { findFirstOrThrow: async ({ where }) => {
    assert.equal(where.clientId, 'client');
    assert.equal(where.marketplace, 'WILDBERRIES');
    assert.equal(where.isActive, true);
    return { apiKey: where.id };
  } } };
  service.loadFbsOrders = async () => fresh;
  service.mergeSyncedFbsTsdRequestOrders = async (_, value) => value;
  service.scopeFbsOrdersForUser = async value => value;
  await service.listFbsOrdersForDisplay('client', {}, true);
  await pending;
  const snapshot = state.value;
  const rendered = await service.listFbsOrdersForDisplay('client', {}, false);
  return { state: { ...state, value: rendered }, snapshot, calls };
}
test('missing handed-over order leaves New through actual display refresh', async () => {
  const old = response([row()]);
  const { state } = await run(old, response([]), async ids => ids.map(id => ({ id, supplierStatus: 'complete', wbStatus: 'sorted' })));
  assert.equal(state.value.orders.length, 1);
  assert.equal(state.value.orders[0].category, 'shipped');
  assert.equal(state.value.orders[0].supplierStatus, 'complete');
  assert.equal(state.value.counts.active, 0);
  assert.equal(old.orders[0].supplierStatus, 'new');
});
test('active, cancelled and sold results use production classification and labels', async () => {
  const { state } = await run(response([row('1'), row('2'), row('3')]), response([]), async () => [
    { id: 1, supplierStatus: 'confirm', wbStatus: 'waiting' },
    { id: 2, supplierStatus: 'cancel', wbStatus: 'canceled' },
    { id: 3, supplierStatus: 'complete', wbStatus: 'sold' },
  ]);
  assert.deepEqual(Array.from(state.value.orders, order => order.category), ['active', 'cancelled', 'archive']);
  assert.equal(state.value.orders[0].statusLabel, 'На сборке');
  assert.equal(state.value.counts.active, 1);
});
test('failure and missing status retain last successful snapshot and expose sync error', async () => {
  for (const read of [async () => { throw Error('WB unavailable'); }, async () => []]) {
    const old = response([row()]);
    const { state, snapshot } = await run(old, response([]), read);
    assert.equal(snapshot, old);
    assert.ok(state.error);
  }
});
test('cabinet scoping, fresh rows and other marketplaces are preserved', async () => {
  const ozon = { ...row('3'), marketplace: 'OZON' };
  const fresh = { ...row('2'), supplierStatus: 'complete', category: 'shipped' };
  const { state, calls } = await run(response([row('1', 'a'), row('1', 'b'), row('2'), ozon]), response([fresh]), async (ids, cabinet) => ids.map(id => ({ id, supplierStatus: cabinet === 'a' ? 'complete' : 'confirm', wbStatus: 'waiting' })));
  assert.equal(calls.length, 2);
  assert.equal(state.value.orders.find(order => order.connectionId === 'a').category, 'shipped');
  assert.equal(state.value.orders.find(order => order.connectionId === 'b').category, 'active');
  assert.equal(state.value.orders.find(order => order.id === '2'), fresh);
  assert.equal(state.value.orders.find(order => order.id === '3'), ozon);
});
test('status requests stay within WB batch limit', async () => {
  const { state, calls } = await run(response(Array.from({ length: 1001 }, (_, i) => row(String(i + 1)))), response([]), async ids => ids.map(id => ({ id, supplierStatus: 'complete', wbStatus: 'sorted' })));
  assert.deepEqual(calls.map(ids => ids.length), [1000, 1]);
  assert.equal(state.value.counts.shipped, 1001);
});
test('repeated refresh retains confirmed shipment without duplicate rows or WB request', async () => {
  const first = await run(response([row()]), response([]), async ids => ids.map(id => ({ id, supplierStatus: 'complete', wbStatus: 'sorted' })));
  const second = await run(first.state.value, response([]), async () => { throw Error('Unexpected status request'); });
  assert.equal(second.calls.length, 0);
  assert.equal(second.state.value.orders.length, 1);
  assert.equal(second.state.value.orders[0].category, 'shipped');
  assert.equal(second.state.value.counts.active, 0);
});
if (process.env.FBS_LIVE_PROOF) test('current official WB answers for screenshot orders', async () => {
  const proof = JSON.parse(fs.readFileSync(process.env.FBS_LIVE_PROOF, 'utf8'));
  const old = response(proof.orders.map(order => row(String(order.id), order.connectionId)));
  const { state } = await run(old, response([]), async (ids, cabinet) => proof.orders.filter(order => order.connectionId === cabinet && ids.includes(order.id)));
  assert.equal(state.value.orders.length, 8);
  assert.equal(state.value.counts.active, 0);
  for (const order of state.value.orders) {
    const official = proof.orders.find(item => String(item.id) === order.id && item.connectionId === order.connectionId);
    assert.equal(order.supplierStatus, official.supplierStatus);
    assert.equal(order.wbStatus, official.wbStatus);
  }
});

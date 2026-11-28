const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addFabricDemand } = require('./fabric-demand');
// TEST: repeated orders in one request do not multiply the requested metres.
test('open fabric request items count by channel and colour', async () => {
  const groups = new Map([['white', {}], ['blue', {}]]);
  const byId = new Map([['a', { key: 'white', meters: 3 }]]);
  const db = { clientRequest: { findMany: async ({ where }) => {
    assert.equal(where.clientId, 'client');
    assert.deepEqual(where.status.notIn, ['DONE', 'CANCELLED', 'REJECTED']);
    return [2, 0].map((links, i) => ({ title: 'Заявка', _count: { fbsOrderLinks: links }, items: [{ skuId: 'a', quantity: i + 1 }] }));
  } } };
  await addFabricDemand(db, 'client', byId, groups);
  assert.deepEqual(groups.get('white').required, { fbs: { pieces: 1, meters: 3 }, fbo: { pieces: 2, meters: 6 } });
  assert.equal(groups.get('blue').required.fbs.meters, 0);
});

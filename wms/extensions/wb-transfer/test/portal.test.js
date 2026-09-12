import test from 'node:test';
import assert from 'node:assert/strict';
import { portalOperation } from '../portal.js';
import { planKey, validCommand, validSender } from '../protocol.js';
const plan = { runId: '7ebe228f-8e21-4e80-890c-641b33403e9c', sourceSupplyId: 'WB-GI-275523494', targetSupplyId: 'WB-GI-277312835',
  targetSupplyName: 'logoff нет на складе', orderIds: ['5700128657'] };
const command = () => ({ ...plan, commandId: 'f01fca42-04e6-4c16-a173-6e971efafabc', expiresAt: new Date(Date.now() + 120000).toISOString() });
function fixture({ wrongAccount = false, switchAccount = false, failPatch = false, retryPatch = false, badResponse = false } = {}) {
  const requests = [];
  globalThis.location = { origin: 'https://seller.wildberries.ru' };
  globalThis.document = { cookie: 'x-supplier-id=account', scripts: [{ src: 'https://static-basket-02.wbbasket.ru/vol20/root-monorepo/latest/main.1b45f8149289a03d.js' }] };
  class RestRequest {
    getIsomorphicFetch(options) {
      return { requestFetch: async () => {
        requests.push(options);
        this.statusCode = options.method === 'PATCH' && failPatch ? 409 : 200;
        if (switchAccount && requests.length === 1) document.cookie = 'x-supplier-id=other';
        if (options.method === 'PATCH') return { error: failPatch, data: { transferredOrders: badResponse ? [] : [{ orderId: 5700128657, oldStickerId: 57692994752, newStickerId: 57884350051 }] } };
        return { data: options.endpoint.endsWith(plan.sourceSupplyId) ? { supplyID: plan.sourceSupplyId, ordersCnt: 30 } :
          { supplyID: wrongAccount ? 'WB-GI-123' : plan.targetSupplyId, name: plan.targetSupplyName, ordersCnt: 0 } };
      } };
    }
    async send(options, method) {
      const transport = this.getIsomorphicFetch({ ...options, method });
      const value = await transport.requestFetch();
      if (retryPatch && method === 'PATCH') await transport.requestFetch();
      return value;
    }
    getRequest(options) { return this.send(options, 'GET'); }
    patchRequest(options) { return this.send(options, 'PATCH'); }
  }
  const chunks = []; chunks.push = value => value[2](() => ({ RestRequest }));
  globalThis.window = { webpackChunk: chunks };
  return requests;
}
// TEST: exact source endpoint, target body and new-sticker response from the reviewed official WB frontend.
test('portal uses source orders/transfer and includes session credentials without exposing them', async () => {
  const requests = fixture(); assert.deepEqual(await portalOperation(command(), true), { transferred: true });
  const patch = requests.find(request => request.method === 'PATCH');
  assert.equal(patch.endpoint, `https://marketplace.wildberries.ru/ns/marketplace-app/marketplace-remote-wh/api/v3/portal/supplies/${plan.sourceSupplyId}/orders/transfer`);
  assert.deepEqual(patch.body, { orderIds: [5700128657], newSupply: plan.targetSupplyId });
  assert.equal(patch.credentials, 'include'); assert.equal(patch.retry, 0); assert.equal(patch.middlewaresAreDisabled, true);
  assert.equal(patch.cache, 'no-store'); assert.equal(requests.length, 3);
});
test('preparation is read-only and validates both supply IDs in the selected account', async () => {
  const requests = fixture(); assert.deepEqual(await portalOperation(plan), { ready: true }); assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.method === 'GET'));
});
for (const [name, options] of Object.entries({ wrongAccount: { wrongAccount: true }, switchAccount: { switchAccount: true } })) {
  test(`${name} blocks mutation`, async () => { const requests = fixture(options); assert.ok((await portalOperation(command(), true)).error); assert.equal(requests.filter(request => request.method === 'PATCH').length, 0); });
}
test('HTTP 409, an incomplete response and automatic SDK retries never replay PATCH', async () => {
  for (const options of [{ failPatch: true }, { badResponse: true }, { retryPatch: true }]) {
    const requests = fixture(options); assert.ok((await portalOperation(command(), true)).error);
    assert.equal(requests.filter(request => request.method === 'PATCH').length, 1);
  }
});
test('an expired command, changed WB runtime and unsafe order id fail before network', async () => {
  let requests = fixture(); assert.ok((await portalOperation({ ...command(), expiresAt: new Date(0).toISOString() }, true)).error); assert.equal(requests.length, 0);
  requests = fixture(); document.scripts = []; assert.ok((await portalOperation(command(), true)).error); assert.equal(requests.length, 0);
  requests = fixture(); assert.ok((await portalOperation({ ...command(), orderIds: ['9007199254740992'] }, true)).error); assert.equal(requests.length, 0);
});
test('strict origin, top frame, command identity and expiry checks', () => {
  const sender = { id: 'extension', url: 'https://wms.logoff.pro/app', frameId: 0, tab: { id: 1 } };
  assert.equal(validSender(sender, 'extension'), true);
  for (const change of [{ url: 'https://wms.logoff.pro.evil.test' }, { url: 'http://wms.logoff.pro' }, { frameId: 2 }, { id: 'other' }]) assert.equal(validSender({ ...sender, ...change }, 'extension'), false);
  assert.equal(validCommand(command()), true); assert.equal(validCommand({ ...command(), expiresAt: 'invalid' }), false);
  assert.throws(() => planKey({ ...plan, orderIds: ['5700128657', '5700128657'] }));
  assert.notEqual(planKey(plan), planKey({ ...plan, targetSupplyId: 'WB-GI-123' }));
});

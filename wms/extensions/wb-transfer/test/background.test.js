import test from 'node:test';
import assert from 'node:assert/strict';
// TEST: exercise the real worker across duplicate messages/restarts; no seller network is used.
test('worker persists intent before execution and blocks another tab, changed plan and restart replay', async () => {
  let listener; const local = {}, session = {}; const calls = [];
  const area = data => ({ get: async key => ({ [key]: data[key] }), set: async values => Object.assign(data, values), remove: async key => { delete data[key]; } });
  globalThis.chrome = { runtime: { id: 'extension', getManifest: () => ({ version: 'test' }), onMessage: { addListener: fn => { listener = fn; } } },
    storage: { local: area(local), session: area(session) }, tabs: { query: async () => [{ id: 2, url: 'https://seller.wildberries.ru/marketplace-orders-fbs' }] },
    scripting: { executeScript: async ({ args }) => { calls.push(args); if (args[1]) assert.ok(local[`attempt:${args[0].runId}`]); return [{ result: args[1] ? { transferred: true } : { ready: true } }]; } } };
  const send = (message, sender = { id: 'extension', frameId: 0, tab: { id: 1 }, documentId: 'page', url: 'https://wms.logoff.pro/app' }) =>
    new Promise(resolve => listener(message, sender, resolve));
  await import('../background.js?first');
  const plan = { runId: '7ebe228f-8e21-4e80-890c-641b33403e9c', sourceSupplyId: 'WB-GI-275523494', targetSupplyId: 'WB-GI-277312835', targetSupplyName: 'Target', orderIds: ['5700128657'] };
  const prepared = await send({ kind: 'PREPARE', plan }); assert.equal(prepared.ok, true);
  const command = { ...plan, commandId: 'f01fca42-04e6-4c16-a173-6e971efafabc', expiresAt: new Date(Date.now() + 120000).toISOString() };
  const message = { kind: 'EXECUTE', ticket: prepared.result.ticket, command };
  assert.equal((await send({ ...message, command: { ...command, targetSupplyId: 'WB-GI-123' } })).ok, false);
  assert.equal((await send(message, { id: 'extension', frameId: 0, tab: { id: 9 }, documentId: 'other-page', url: 'https://wms.logoff.pro/app' })).ok, false);
  const responses = await Promise.all([send(message), send(message)]); assert.equal(responses.filter(response => response.ok).length, 1);
  assert.equal(calls.filter(([, execute]) => execute).length, 1);
  await import('../background.js?restart');
  const again = await send({ kind: 'PREPARE', plan });
  assert.equal((await send({ ...message, ticket: again.result.ticket })).ok, false);
  assert.equal(calls.filter(([, execute]) => execute).length, 1);
  assert.equal((await send({ kind: 'PING' }, { url: 'https://attacker.test', tab: { id: 1 }, id: 'extension', frameId: 0 })).ok, false);
});

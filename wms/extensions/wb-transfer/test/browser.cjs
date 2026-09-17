// TEST: load the actual MV3 extension and exercise content -> worker -> MAIN-world -> response.
// All HTTP traffic is intercepted; no real WMS session, seller token, or WB order is used.
const { chromium } = require(process.env.WMS_PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const plan = { runId: '7ebe228f-8e21-4e80-890c-641b33403e9c', sourceSupplyId: 'WB-GI-275523494', targetSupplyId: 'WB-GI-277312835', targetSupplyName: 'Target', orderIds: ['5700128657'] };
(async () => {
  assert(process.env.WMS_BROWSER_TEST_DIR, 'Set an isolated WMS_BROWSER_TEST_DIR inside the workspace');
  const extension = path.resolve(__dirname, '..');
  fs.mkdirSync(process.env.WMS_BROWSER_TEST_DIR, { recursive: true });
  const profile = fs.mkdtempSync(path.join(process.env.WMS_BROWSER_TEST_DIR, 'run-'));
  const context = await chromium.launchPersistentContext(profile, { headless: true,
    ...(process.env.WMS_BROWSER_EXECUTABLE ? { executablePath: process.env.WMS_BROWSER_EXECUTABLE } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions'] });
  try {
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html lang="ru"><title>Isolated WB bridge test</title><body>Test fixture</body></html>' }));
    await context.addCookies([{ name: 'x-supplier-id', value: 'test-account', domain: 'seller.wildberries.ru', path: '/', secure: true }]);
    const wb = await context.newPage(); await wb.goto('https://seller.wildberries.ru/marketplace-orders-fbs');
    await wb.evaluate(plan => {
      const script = document.createElement('script'); script.type = 'application/x-test';
      script.src = 'https://static-basket-02.wbbasket.ru/vol20/root-monorepo/latest/main.1b45f8149289a03d.js'; document.head.appendChild(script);
      window.requests = [];
      class RestRequest {
        getIsomorphicFetch(options) { return { requestFetch: async () => {
          window.requests.push({ method: options.method, endpoint: options.endpoint, body: options.body }); this.statusCode = 200;
          const data = options.method === 'PATCH' ? { transferredOrders: [{ orderId: 5700128657, oldStickerId: 57692994752, newStickerId: 57884350051 }] } :
            options.endpoint.endsWith(plan.sourceSupplyId) ? { supplyID: plan.sourceSupplyId, ordersCnt: 30 } : { supplyID: plan.targetSupplyId, ordersCnt: 0, name: plan.targetSupplyName };
          return { data };
        } }; }
        getRequest(options) { return this.getIsomorphicFetch({ ...options, method: 'GET' }).requestFetch(); }
        patchRequest(options) { return this.getIsomorphicFetch({ ...options, method: 'PATCH' }).requestFetch(); }
      }
      window.webpackChunk = []; window.webpackChunk.push = chunk => chunk[2](() => ({ RestRequest }));
    }, plan);
    const wms = await context.newPage(); await wms.goto('https://wms.logoff.pro/');
    const send = message => wms.evaluate(message => new Promise((resolve, reject) => {
      const id = crypto.randomUUID(); const timer = setTimeout(() => reject(Error('No extension response')), 10000);
      const listener = event => { if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'LOGOFF_WB_RESPONSE' || event.data.id !== id) return;
        clearTimeout(timer); window.removeEventListener('message', listener); resolve(event.data.response); };
      window.addEventListener('message', listener); window.postMessage({ channel: 'LOGOFF_WB_REQUEST', id, message }, location.origin);
    }), message);
    assert.equal((await send({ kind: 'PING' })).ok, true);
    const prepared = await send({ kind: 'PREPARE', plan }); assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const message = { kind: 'EXECUTE', ticket: prepared.result.ticket, command: { ...plan, commandId: 'f01fca42-04e6-4c16-a173-6e971efafabc', expiresAt: new Date(Date.now() + 120000).toISOString() } };
    const response = await send(message); assert.deepEqual(response, { ok: true, result: { transferred: true } });
    assert.equal((await send(message)).ok, false);
    const requests = await wb.evaluate(() => window.requests);
    assert.equal(requests.filter(request => request.method === 'PATCH').length, 1);
    assert(requests.every(request => request.endpoint.startsWith('https://marketplace.wildberries.ru/')));
    console.log(JSON.stringify({ extensionLoaded: true, bridgeRoundTrip: true, duplicateBlocked: true, portalPatchCount: 1, requests }, null, 2));
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

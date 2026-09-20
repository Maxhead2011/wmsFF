import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const session = { accessToken: 'qa-only', user: { id: 'qa', roleCodes: ['OWNER'], activeWarehouseId: 'warehouse' } };
const html = `<html><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client';
import {SizeSubstitutionPanel} from '/src/components/service/SizeSubstitutionPanel.tsx';
createRoot(document.getElementById('root')).render(React.createElement(SizeSubstitutionPanel,{session:${JSON.stringify(session)},clientId:'client'}));
</script></body></html>`;
// TEST: run the real component with isolated API responses; no production login or network.
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5197, strictPort: true }, plugins: [{ name: 'size-qa', configureServer(vite) {
  vite.middlewares.use('/__size_qa', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__size_qa', html)); });
} }] });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const page = await browser.newPage();
  const errors = [], sent = [];
  page.on('pageerror', e => errors.push(e.message));
  const product = { id: 'target', name: 'Костюм', article: 'Корея', size: 'S / 42', color: 'голубой', barcodes: ['target-barcode'] };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.endsWith('/preview')) return route.fulfill({ json: { taskId: 'task', previewToken: 'a'.repeat(64), target: product,
      options: [{ ...product, id: 'source', size: 'XS / 40', barcodes: ['source-barcode'], distance: 1, available: 1, boxes: [{ id: 'box', code: 'BOX-1', pallet: 'PL-1', available: 1 }] }] } });
    sent.push(route.request().postDataJSON()); return route.fulfill({ json: { id: 'request', number: 1200 } });
  });
  await page.goto('http://127.0.0.1:5197/__size_qa');
  await page.getByLabel('Номер заказа WB').fill('5786259714');
  await page.getByRole('button', { name: 'Предложить замены' }).click();
  await page.getByRole('checkbox').first().check();
  assert.equal(await page.getByRole('button', { name: 'Создать заявку на сборку' }).isDisabled(), true);
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'Создать заявку на сборку' }).click();
  await page.getByRole('status').waitFor();
  assert.equal(sent.length, 1); assert.equal(sent[0].sourceSkuId, 'source'); assert.equal(sent[0].confirmRelabel, true);
  assert.match(await page.getByRole('status').innerText(), /001200/);
  await page.getByLabel('Номер заказа WB').fill('123');
  assert.equal(await page.getByRole('button', { name: 'Создать заявку на сборку' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: explicit choice, relabel confirmation, single creation, order-change reset, no browser errors');
} finally { await browser?.close(); await server.close(); }

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';

// TEST: real FbsPanel, synthetic data, and intercepted API; never use a production login.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.env.FBS_DELIVERY_QA_OUTPUT || join(root, 'test-results/fbs-delivery');
await mkdir(out, { recursive: true });
const session = { accessToken: 'qa-only', tokenType: 'Bearer', user: { id: 'qa-user', email: 'qa@example.test', name: 'QA', roleCodes: ['ADMIN'], permissionCodes: [], activeWarehouseId: 'qa-warehouse', clientIds: ['qa-client'], writableClientIds: ['qa-client'], clientScopeMode: 'ALL' } };
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FbsPanel } from '/src/components/fbs/FbsPanel.tsx';
import '/src/styles.css';
createRoot(document.getElementById('root')).render(React.createElement(FbsPanel, { session: ${JSON.stringify(session)} }));
</script></body></html>`;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5198, strictPort: true }, plugins: [{ name: 'fbs-delivery-qa', configureServer(vite) {
  vite.middlewares.use('/__fbs_delivery_qa', async (_req, res, next) => {
    try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__fbs_delivery_qa', html)); } catch (error) { next(error); }
  });
} }] });
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], unexpected = [], submissions = [];
page.on('pageerror', error => errors.push(error.message));
const client = { id: 'qa-client', code: 'QA', name: 'Тестовый клиент' };
const order = { id: 'qa-order', connectionId: 'qa-cabinet', accountName: 'QA WB', marketplace: 'WILDBERRIES', category: 'active', supplierStatus: 'confirm', wbStatus: 'waiting', statusLabel: 'На сборке', article: 'QA-1', barcodes: ['QA-BC'], itemCount: 2, product: { id: 'qa-sku', name: 'Тестовый товар', internalSku: 'QA-SKU', article: 'QA-1', size: '42' }, storageBoxes: [], createdAt: new Date().toISOString(), supplyId: 'WB-GI-QA', warehouseId: '123', warehouseName: 'Тестовый склад WB', officeId: '123', requiredMeta: [], optionalMeta: [], request: null, billing: null, shipmentPlan: null };
const data = { client, connected: true, connections: [{ id: 'qa-cabinet', marketplace: 'WILDBERRIES', accountName: 'QA WB' }], fetchedAt: new Date().toISOString(), deliveryPlan: { destination: 'SORTING_CENTER', requiresCargoPlaces: false, itemsPerCargoPlace: 1 }, counts: { active: 1, shipped: 0, cancelled: 0, archive: 0, all: 1 }, orders: [order] };
const date = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
const options = { supplies: [{ connectionId: 'qa-cabinet', supplyId: 'WB-GI-QA', orderCount: 1, itemCount: 2, destinationOfficeId: '123', destinationOfficeName: 'Тестовый склад WB' }], offices: [{ id: '123', name: 'Тестовый склад WB', city: 'Москва', compatible: true }, { id: '456', name: 'Другой склад', city: '', compatible: false }], requiredDestinationOfficeId: '123', earliestWbDeliveryDate: null, defaultPlannedDeliveryDate: date, blockers: [] };
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== '127.0.0.1') { unexpected.push(url.origin); return route.abort(); }
  if (!url.pathname.startsWith('/api/')) return route.continue();
  let response;
  if (url.pathname.endsWith('/clients')) response = [client];
  else if (url.pathname.endsWith('/active-clients')) response = [{ client, activeOrders: 1, fetchedAt: data.fetchedAt }];
  else if (url.pathname.endsWith('/orders')) response = data;
  else if (url.pathname.endsWith('/delivery-options')) response = options;
  else if (url.pathname.endsWith('/deliver')) { submissions.push(route.request().postDataJSON()); response = { delivered: 1, failed: [], orders: data }; }
  else { unexpected.push(url.pathname); return route.abort(); }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
});
try {
  await page.goto('http://127.0.0.1:5198/__fbs_delivery_qa');
  await page.getByRole('button', { name: /Wildberries/i }).click();
  await page.getByRole('button', { name: 'Передать WB', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  assert.equal(submissions.length, 0);
  assert.equal(await dialog.locator('option[value="456"]').evaluate(option => option.disabled), true);
  await dialog.getByLabel('Плановая дата доставки').fill('');
  assert.equal(await dialog.getByRole('button', { name: 'Подтвердить и передать WB' }).isDisabled(), true);
  await dialog.getByLabel('Плановая дата доставки').fill(date);
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 1001);
    await page.screenshot({ path: join(out, `delivery-${width}.png`) });
  }
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal(submissions.length, 0);
  await page.getByRole('button', { name: 'Передать WB', exact: true }).click(); await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Подтвердить и передать WB' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(submissions, [{ clientId: 'qa-client', orders: [{ connectionId: 'qa-cabinet', id: 'qa-order' }], destinationOfficeId: '123', plannedDeliveryDate: date }]);
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ result: 'PASS', realPanel: true, deliveryRequests: submissions.length, viewports: [1440, 768, 375], consoleErrors: errors, unexpectedRequests: unexpected, screenshotDirectory: out, visualBaselineComparison: 'INCONCLUSIVE: no committed baseline' }));
} finally { await browser.close(); await server.close(); }

// TEST: isolated browser checks against the real component with synthetic API responses.
// No production API, account, order or physical printer is used.
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.WMS_QA_PLAYWRIGHT || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5187, strictPort: true }, plugins: [{
  name: 'order-search-test-page',
  configureServer(server) {
    server.middlewares.use('/__order-search-test', async (_req, res) => {
      const html = await server.transformIndexHtml('/__order-search-test', `<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div><script type="module">
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {OrderAssemblyPanel} from '/src/components/order-assembly/OrderAssemblyPanel.tsx';
        createRoot(document.getElementById('root')).render(React.createElement(OrderAssemblyPanel,{session:{accessToken:'synthetic-test-token'}}));
      </script></body></html>`);
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    });
  },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.WMS_QA_BROWSER ? { executablePath: process.env.WMS_QA_BROWSER } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(15000);
  const errors = []; const calls = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__printedTestLabels = [];
    window.open = () => ({ document: { write: html => window.__printedTestLabels.push(html), close() {} } });
  });
  const old = { id: 'old-test', orderId: '5630810674', printedAt: '2025-01-01T10:00:00Z', kiz: 'TEST-KIZ', productName: 'Тестовый товар', printedBy: 'Тест', article: 'TEST', size: 'M', color: 'Синий' };
  await page.route('**/api/**', async route => {
    const req = route.request(); const url = new URL(req.url()); calls.push({ method: req.method(), path: url.pathname, search: url.search });
    const query = url.searchParams.get('orderId');
    if (url.pathname.endsWith('/history')) {
      if (query === '999') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Тест: история временно недоступна' }) });
      if (query === '111') await new Promise(r => setTimeout(r, 500));
      return route.fulfill({ json: query === old.orderId ? [old] : query ? [] : [{ ...old, id: 'recent-test', orderId: '5700000000', printedAt: '2026-09-05T10:00:00Z' }] });
    }
    if (url.pathname.endsWith('/old-test/reprint')) return route.fulfill({ json: { ...old, requestNumber: 633, warehouseName: 'Тестовый склад', contentType: 'image/png', imageBase64: '' } });
    throw Error('Unexpected API call: '+req.method()+' '+url.pathname);
  });
  await page.goto('http://127.0.0.1:5187/__order-search-test');
  await page.getByRole('cell', { name: '5700000000', exact: true }).waitFor();
  const search = page.getByLabel('Номер заказа WB', { exact: true });
  await page.locator('input[type=date]').first().fill('2026-09-01');
  await search.fill('5630810674'); await search.press('Enter');
  await page.getByRole('cell', { name: '5630810674', exact: true }).waitFor();
  assert.equal(await page.locator('input[type=date]').first().inputValue(), '');
  assert(!calls.some(c => c.method !== 'GET'), 'Search must never mutate/print');
  await page.getByTitle('Повторная печать', { exact: true }).click();
  await page.getByText('Повторно напечатан заказ №5630810674', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__printedTestLabels.length), 1);
  assert.equal(calls.filter(c => c.path.endsWith('/reprint')).length, 1);
  await search.fill('888'); await search.press('Enter');
  await page.getByText(/В доступной истории печати заказ не найден/).waitFor();
  await search.fill('999'); await search.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Тест: история временно недоступна' }).waitFor();
  assert.equal(await page.getByTitle('Повторная печать', { exact: true }).count(), 0);
  await search.fill('111'); await search.press('Enter');
  await page.getByRole('button', { name: 'Сбросить поиск', exact: true }).click();
  await page.getByRole('cell', { name: '5700000000', exact: true }).waitFor();
  await page.waitForTimeout(650); // Wait beyond the deliberately delayed obsolete response.
  assert.equal(await page.getByRole('cell', { name: '5700000000', exact: true }).count(), 1);
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1100 });
    await search.scrollIntoViewIfNeeded();
    const bounds = await search.boundingBox();
    assert(bounds && bounds.width > 50 && bounds.x >= 0 && bounds.x+bounds.width <= width, 'Search must fit viewport '+width);
    if (process.env.WMS_QA_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.WMS_QA_SCREENSHOT_DIR}/order-search-${width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['old order search', 'date reset', 'GET-only search', 'existing reprint', 'not found', 'API error', 'stale response ignored', '1440/768/375 input layout'], apiCalls: calls }));
} finally {
  await browser?.close(); await server.close();
}

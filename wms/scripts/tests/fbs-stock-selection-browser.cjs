// TEST: built web application, isolated educational API; never sends marketplace mutations.
// Run after web build: node scripts/tests/fbs-stock-selection-browser.cjs <output-directory>
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dist = path.resolve(process.env.WEB_DIST || path.resolve(__dirname, '../../apps/web/dist'));
const overlay = process.env.WEB_OVERLAY && path.resolve(process.env.WEB_OVERLAY);
const out = path.resolve(process.argv[2]); fs.mkdirSync(out, { recursive: true });
const user = { id: 'test-client', email: 'client@example.test', name: 'Учебный клиент', roleCodes: ['CLIENT'], permissionCodes: ['stock:read', 'client-requests:read', 'client-requests:write', 'billing:read', 'catalog:read', 'receipts:read'], clientScopeMode: 'LIMITED', clientIds: ['demo'], writableClientIds: ['demo'], warehouseIds: [], writableWarehouseIds: [] };
const client = { id: 'demo', code: 'CL-DEMO', name: 'Учебный клиент', legalName: 'Учебный клиент', status: 'ACTIVE' };
const connections = [{ id: 'shop', marketplace: 'WILDBERRIES', accountName: 'Учебный магазин WB' }];
const items = Array.from({ length: 400 }, (_, i) => ({
  skuId: 'sku-' + i, name: i < 10 ? 'Костюм размер ' + i : 'Другой товар ' + i,
  internalSku: 'SKU-' + i, article: i < 10 ? 'MATCH' : 'OTHER-' + i, size: String(i), barcode: '2000000' + i,
  nmId: String(i), chrtId: String(i), status: 'SELLING', enabled: true, wmsAvailable: 10, reserved: 0,
  safetyReserve: 0, sellable: 10, wbAmount: 10, publishedAmount: 10, saleLimit: null, relabelManualAmount: null,
  relabeling: { isSource: false, isTarget: false, sources: [], allocatedFromSources: 0, allocatedToTargets: 0, capacity: 0 },
  requestedAmount: 10, targetAmount: 10, shortage: false, shortageAmount: 0, difference: 0,
}));
const stocks = () => ({ client, connected: true, connections, selectedConnectionId: 'shop',
  warehouses: [{ id: 'warehouse', name: 'Учебный склад WB' }], selectedWarehouseId: 'warehouse', connectedWarehouseId: 'warehouse',
  summary: { products: 400, enabled: 400, disabled: 0, unmanaged: 0, wmsAvailable: 4000, sellable: 4000, wbAmount: 4000, differences: 0, excessProducts: 0, excessUnits: 0, shortages: 0 }, items });
const mutations = [], errors = [];
const server = http.createServer((req, res) => {
  let file = path.resolve(dist, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(dist + path.sep)) file = path.join(dist, 'index.html');
  if (overlay) {
    const candidate = path.join(overlay, path.relative(dist, file));
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) file = candidate;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(overlay || dist, 'index.html');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.WEB_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
      const p = url.pathname.replace(/^\/api(?:\/v1)?/, ''); let data = [];
      if (p === '/auth/me') data = user;
      else if (p === '/clients') data = [client];
      else if (p === '/marketplace-connections/fbs/active-clients') data = [{ client, activeOrders: 0 }];
      else if (p === '/marketplace-connections/fbs/orders') data = { client, connected: true, connections, counts: { active: 0, shipped: 0, cancelled: 0, archive: 0, all: 0 }, orders: [] };
      else if (p === '/marketplace-connections/fbs/stocks') data = stocks();
      else if (p.includes('/stocks/publication')) {
        const body = request.postDataJSON(); mutations.push(body);
        data = { updatedProducts: body.skuIds.length, amount: 0 };
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await context.addInitScript(u => {
      localStorage.setItem('logoff-wms-session', JSON.stringify({ accessToken: 'isolated-test', tokenType: 'Bearer', user: u }));
      localStorage.setItem('logoff-wms-ui-theme:' + u.id, 'modern');
    }, user);
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin);
    await page.locator('aside').getByRole('button', { name: 'FBS', exact: true }).click();
    await page.getByRole('button', { name: /FBS WB/ }).click();
    await page.getByRole('tab', { name: /Товары FBS/ }).click();
    const section = page.locator('.fbs-stocks'); await section.waitFor();
    const search = page.getByPlaceholder('Заказ, ШК, товар или короб');
    await search.fill('MATCH');
    const header = section.locator('thead input[type=checkbox]');
    const global = section.locator('.fbs-stocks__select-all input');
    const count = section.locator('.fbs-stocks__bulkbar [role=status]');
    await page.waitForFunction(() => document.querySelectorAll('.fbs-stocks tbody tr').length === 10);
    await header.check(); await page.waitForFunction(() => document.querySelector('.fbs-stocks__bulkbar [role=status]').textContent.includes('Выбрано: 10 '));
    assert.equal(await global.isChecked(), false);
    await section.locator('.fbs-stocks__bulkbar').screenshot({ path: path.join(out, 'selection.png') });
    const stop = section.getByRole('button', { name: 'Не продавать выбранные', exact: true });
    let confirmation = '';
    page.once('dialog', async dialog => { confirmation = dialog.message(); await dialog.dismiss(); });
    await stop.click(); assert.match(confirmation, /10[\s\S]*Учебный склад WB/); assert.equal(mutations.length, 0);
    page.once('dialog', dialog => dialog.accept()); await stop.click();
    await page.waitForFunction(() => document.querySelector('.fbs-stocks__message')?.textContent.includes('Остановлено товаров: 10'));
    assert.deepEqual(mutations[0].skuIds, items.slice(0, 10).map(x => x.skuId));
    assert.equal(mutations[0].enabled, false);
    await global.check(); assert.match(await count.textContent(), /Выбрано: 400[\s\S]*фильтрами: 390/);
    await header.uncheck(); assert.match(await count.textContent(), /Выбрано: 390/);
    await header.check(); await global.uncheck();
    await search.fill(''); await header.check(); assert.match(await count.textContent(), /Выбрано: 400/);
    await section.getByRole('button', { name: /Далее/ }).click();
    assert.equal(await section.locator('tbody input[type=checkbox]:checked').count(), 100);
    await header.uncheck();
    await search.fill('MATCH'); await section.locator('tbody input[type=checkbox]').first().check();
    assert.equal(await header.evaluate(e => e.indeterminate), true);
    await search.fill('ABSENT'); assert.equal(await header.isDisabled(), true);
    await search.fill('MATCH');
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await section.locator('.fbs-stocks__bulkbar').screenshot({ path: path.join(out, `selection-${width}.png`) });
      assert.equal(await stop.isVisible(), true);
      assert.ok((await global.boundingBox()).width >= 16, 'Global checkbox must not shrink on narrow screens');
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ builtWeb: true, isolatedApi: true, passed: ['10 of 400', 'cancel without API call', 'confirmed exact payload', 'independent global choice', 'hidden count', 'all filtered pages', 'partial selection', 'empty search', 'three viewport widths'], mutations: mutations.length }, null, 2));
    console.log('PASS built web: filtered/global selection, confirmation, exact payload, pagination, empty/partial selection; screenshots at 1440/768/390.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });

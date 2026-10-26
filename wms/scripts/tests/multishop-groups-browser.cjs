// TEST: compile the actual editor; all requests are served by this isolated local fixture.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { createRequire } = require('node:module');
const esbuild = createRequire(require.resolve('../../apps/web/node_modules/vite'))('esbuild');
const root = path.resolve(__dirname, '../..'), out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });
(async () => {
  const source = `import React from 'react';import {createRoot} from 'react-dom/client';import {MultishopStockGroupsView} from './src/components/fbs/MultishopStockGroupsView';import './src/components/fbs/multishop-stock-groups.css';
  createRoot(document.getElementById('root')).render(<MultishopStockGroupsView clientId="demo" session={{accessToken:'fixture',user:{id:'admin',permissionCodes:['system:admin'],writableClientIds:[]}}}/>);`;
  await esbuild.build({ stdin: { contents: source, loader: 'tsx', resolveDir: root + '/apps/web' }, outfile: out + '/editor.js', bundle: true, jsx: 'automatic', define: { 'import.meta.env.VITE_API_URL': '"/api/v1"' } });
  const connections = ['wb1', 'ozon1', 'wb2', 'ozon2'].map(id => ({ id, accountName: id, marketplace: id.startsWith('wb') ? 'WILDBERRIES' : 'OZON', fbsExecutionWarehouseId: 'msk' }));
  let saved = { revision: null, config: { groups: [], assignments: [] } }, stale = false;
  const writes = [], unexpected = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html');res.end('<html><head><link rel="stylesheet" href="/editor.css"></head><body><div id="root"></div><script src="/editor.js"></script></body></html>');return; }
    if (['/editor.js', '/editor.css'].includes(url.pathname)) { res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css'); res.end(fs.readFileSync(out + url.pathname));return; }
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/v1/marketplace-connections/multishop/demo/products') { res.end(JSON.stringify({ items: [{ id: 'size-52', name: 'Костюм', article: 'A', size: '52', color: 'Синий', barcodes: [{ value: '001' }] }], page: 1, pageSize: 50, total: 1 }));return; }
    if (url.pathname === '/api/v1/marketplace-connections/multishop/demo') {
      if (req.method === 'PUT') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);writes.push(body);
        if (stale) { res.statusCode = 409;res.end(JSON.stringify({ message: 'Настройки изменены другим пользователем.' }));return; }
        assert.equal(body.revision, saved.revision);saved = { config: body.config, revision: 'saved-v1' };
      }
      res.end(JSON.stringify({ ...saved, connections, invalidReason: null, publicationEnabled: false }));return;
    }
    if (url.pathname !== '/favicon.ico') unexpected.push(url.pathname);
    res.statusCode = 404;res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try { browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) }); }
  catch (error) { server.close();throw error; }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: 'Добавить группу', exact: true }).click();
    await page.getByLabel('Название группы').fill('Первая пара');
    await page.getByLabel('WB · wb1', { exact: true }).check();
    await page.getByLabel('Ozon · ozon1', { exact: true }).check();
    await page.getByLabel('Доля, %', { exact: true }).nth(0).fill('50');
    await page.getByLabel('Доля, %', { exact: true }).nth(1).fill('50');
    await page.getByLabel('Выбрать Костюм', { exact: true }).check();
    await page.getByLabel('Группа для выбранных товаров').selectOption({ label: 'Первая пара' });
    await page.getByRole('button', { name: 'Назначить выбранным (1)', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Группы и назначения сохранены' }).waitFor();
    assert.equal(writes.length, 1); assert.deepEqual(saved.config.groups[0].members.map(m => m.connectionId), ['wb1', 'ozon1']);
    assert.deepEqual(saved.config.assignments, [{ skuId: 'size-52', groupId: saved.config.groups[0].id }]);
    assert.equal(await page.getByRole('button', { name: 'Удалить пустую группу' }).isDisabled(), true);
    // TEST: switching modes preserves shares; the selected mode and reserve survive reload.
    await page.getByLabel('Режим остатка', { exact: true }).selectOption('SHARED');
    await page.getByLabel('Страховой запас, шт.', { exact: true }).fill('3');
    assert.equal(await page.getByLabel('Доля, %', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Группы и назначения сохранены' }).waitFor();
    assert.equal(saved.config.groups[0].mode, 'SHARED');
    assert.equal(saved.config.groups[0].safetyReserve, 3);
    await page.reload();
    await page.getByLabel('Режим остатка', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Режим остатка', { exact: true }).inputValue(), 'SHARED');
    assert.equal(await page.getByLabel('Страховой запас, шт.', { exact: true }).inputValue(), '3');
    await page.getByLabel('Режим остатка', { exact: true }).selectOption('ALLOCATED');
    assert.equal(await page.getByLabel('Доля, %', { exact: true }).nth(0).inputValue(), '50');
    assert.equal(await page.getByLabel('Доля, %', { exact: true }).nth(1).inputValue(), '50');
    stale = true;
    await page.getByLabel('Название группы').fill('Несохранённая правка');
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'другим пользователем' }).waitFor();
    assert.equal(await page.getByLabel('Название группы').inputValue(), 'Несохранённая правка');
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= 390));
    await page.screenshot({ path: out + '/mobile.png', fullPage: true });
    assert.deepEqual(errors, []);assert.deepEqual(unexpected, []);
    const proof = { isolatedApi: true, externalWrites: 0, passed: ['exclusive-pair', 'canonical-sku-assignment', 'revision-on-save', 'assigned-group-delete-disabled', 'shared-mode-save-reload', 'reserve-save-reload', 'mode-switch-preserves-shares', 'conflict-retains-draft', 'mobile-width', 'no-runtime-errors'] };
    fs.writeFileSync(out + '/proof.json', JSON.stringify(proof, null, 2));console.log(proof);
  } finally { await browser.close();server.close(); }
})().catch(e => { console.error(e);process.exitCode = 1; });

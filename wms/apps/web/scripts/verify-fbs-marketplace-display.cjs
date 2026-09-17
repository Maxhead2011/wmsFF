// TEST: browser regression for independent FBS filters and entry-card count requests.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dist = path.resolve(__dirname, '../dist');
(async () => {
  const server = http.createServer((req, res) => {
    let file = path.join(dist, new URL(req.url, 'http://localhost').pathname);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 2628, height: 1131 } });
    const requests = [], errors = [];
    const user = { id: 'test', name: 'Test', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [], activeWarehouseId: 'msk' };
    await page.addInitScript(user => localStorage.setItem('logoff-wms-session', JSON.stringify({ accessToken: 'test-only', user })), user);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url()); requests.push(url);
      let data = [];
      if (url.pathname.endsWith('/auth/me')) data = user;
      else if (url.pathname === '/api/v1/branches') data = [{ id: 'msk', name: 'ФФ Москва', city: 'Москва', code: 'MSK', isActive: true }];
      else if (url.pathname.endsWith('/unread-count')) data = { count: 0 };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: 'FBS', exact: true }).first().click();
    const select = page.getByLabel('Режим отображения');
    const back = () => page.getByRole('button', { name: 'Назад к выбору FBS' }).click();
    await page.locator('.fbs-marketplace-card--wb').click();
    assert.equal(await select.inputValue(), 'msk');
    // TEST: compact two-row desktop grid and a readable display selector.
    const tiles = page.locator('.fbs-tiles > .fbs-tile');
    assert.equal(await tiles.count(), 15);
    const boxes = await tiles.evaluateAll(nodes => nodes.map(node => {
      const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, height: b.height };
    }));
    assert(Math.abs(boxes[8].x - boxes[1].x) < 2, 'Tile 9 must sit under tile 2');
    assert(Math.abs(boxes[14].x - boxes[7].x) < 2, 'Tile 15 must sit under tile 8');
    assert(boxes[0].height > boxes[1].height * 1.8, 'First tile must span two rows');
    assert((await select.boundingBox()).width >= 220, 'Display selector is squeezed');
    if (process.env.FBS_SCREENSHOT) await page.locator('.fbs-panel').screenshot({ path: process.env.FBS_SCREENSHOT });
    await page.getByRole('tab', { name: /Повторный довоз/ }).click();
    assert(await page.getByRole('tabpanel', { name: 'Повторный довоз', exact: true }).isVisible());
    assert(await page.getByText('Выберите клиента для повторного довоза.').isVisible());
    for (const width of [1280, 724, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      assert((await select.boundingBox()).width >= 220, `Selector too narrow at ${width}`);
      const overflow = await page.locator('.fbs-panel').evaluate(panel => [...panel.querySelectorAll('.fbs-panel__hero, .fbs-display-mode, .fbs-tiles, .fbs-tile')].filter(e => e.getBoundingClientRect().right > panel.getBoundingClientRect().right + 1).map(e => e.className));
      assert.deepEqual(overflow, [], `FBS layout overflow at ${width}`);
    }
    await page.setViewportSize({ width: 2628, height: 1131 });
    await back();
    await page.locator('.fbs-marketplace-card--ozon').click();
    assert.equal(await page.getByRole('tab', { name: /Повторный довоз/ }).count(), 0);
    await select.selectOption('all');
    await back();
    await page.locator('.fbs-marketplace-card--wb').click();
    assert.equal(await select.inputValue(), 'msk');
    await back();
    await page.locator('.fbs-marketplace-card--ozon').click();
    assert.equal(await select.inputValue(), 'all');
    requests.length = 0;
    await back();
    await page.waitForFunction(() => [...document.querySelectorAll('.fbs-marketplace-card__active')].every(e => !e.textContent.includes('Считаем')));
    await page.waitForTimeout(500);
    const latest = marketplace => requests.filter(url => url.pathname.endsWith('/fbs/active-clients') && url.searchParams.get('marketplace') === marketplace).at(-1);
    assert.equal(latest('WILDBERRIES')?.searchParams.get('displayWarehouseId'), 'msk');
    assert.equal(latest('WILDBERRIES')?.searchParams.has('allBranches'), false);
    assert.equal(latest('OZON')?.searchParams.get('allBranches'), '1');
    assert.equal(latest('OZON')?.searchParams.has('displayWarehouseId'), false);
    assert(!requests.some(url => url.pathname.endsWith('/activate')));
    assert.deepEqual(errors, []);
    console.log('PASS: independent WB/Ozon selections and marketplace counters; working branch unchanged');
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

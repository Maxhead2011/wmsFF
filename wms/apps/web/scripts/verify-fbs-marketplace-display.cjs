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
    const page = await browser.newPage();
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
    await back();
    await page.locator('.fbs-marketplace-card--ozon').click();
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

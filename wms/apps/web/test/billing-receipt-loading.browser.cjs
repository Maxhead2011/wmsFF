// TEST: exercise the real receipt tab through delayed, failed and retried client-scoped responses.
// All API requests use local fixtures; this test never contacts production or records money.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('C:/Users/HonorPC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(process.argv[2]);
const overlay = process.argv[3] ? path.resolve(process.argv[3], 'web') : null;
const user = { id: 'fixture', name: 'Константин', roleCodes: ['OWNER'], permissionCodes: ['system:admin', 'billing:read', 'billing:write'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [], activeWarehouseId: 'w', warehouseIds: ['w'], writableWarehouseIds: ['w'] };
const client = { id: 'c', code: 'CL-TEST', name: 'Тестовый клиент' };
const invoice = { id: 'i', number: 'TEST-RECEIPT', clientId: 'c', client, status: 'ISSUED', serviceCategory: 'STORAGE', periodFrom: '2026-09-01', periodTo: '2026-09-30', createdAt: '2026-10-01', totalRub: 550535.37, paidRub: 450000, items: [], payments: [{ id: 'p', amountRub: 450000, status: 'RECORDED', paidAt: '2026-10-03', reference: 'TEST-PAYMENT' }] };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  const candidate = overlay && (pathname === '/' ? path.join(overlay, 'index.html') : pathname.startsWith('/assets/') ? path.join(overlay, path.basename(pathname)) : null);
  const file = candidate && fs.existsSync(candidate) ? candidate : path.resolve(root, '.' + pathname.replace(/\/$/, '/index.html'));
  if (!(file.startsWith(root + path.sep) || overlay && file.startsWith(overlay + path.sep)) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage(), errors = [], writes = [], scoped = [];
    let mode = 'hold', release;
    const held = new Promise(resolve => { release = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(user => localStorage.setItem('logoff-wms-session', JSON.stringify({ accessToken: 'fixture-only', tokenType: 'Bearer', user })), user);
    await page.route('**/api/v1/**', async route => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      if (req.method() !== 'GET') writes.push(p);
      let data = [], status = 200;
      if (p.endsWith('/auth/me')) data = user;
      else if (p.endsWith('/branches')) data = [{ id: 'w', code: 'MSK', name: 'Москва', warehouseId: 'w', isActive: true }];
      else if (p.endsWith('/clients')) data = [client];
      else if (p.endsWith('/billing/invoices')) {
        if (url.searchParams.get('clientId') === 'c') {
          scoped.push(url.search);
          if (mode === 'hold') { await held; status = 500; data = { message: 'Тестовая ошибка загрузки счетов' }; }
          else data = [invoice];
        } else data = [invoice];
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.getByRole('button', { name: 'Биллинг', exact: true }).click();
    await page.getByRole('tab', { name: 'Приход ДС', exact: true }).click();
    await page.getByRole('heading', { name: 'Приход денежных средств', exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: 'Загрузка клиентов и счетов' }).waitFor();
    assert.equal(await page.locator('.billing-cash-receipt__submit').isDisabled(), true);
    assert.equal(await page.getByText('У клиента нет неоплаченных счетов.', { exact: true }).count(), 0);
    release();
    await page.getByRole('alert').filter({ hasText: 'Тестовая ошибка' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Приход денежных средств', exact: true }).count(), 1);
    mode = 'ready'; await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await page.getByText('TEST-PAYMENT', { exact: true }).waitFor();
    await page.getByLabel('Выбрать счёт TEST-RECEIPT', { exact: true }).waitFor();
    assert.ok(scoped.length >= 2); assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    console.log('PASS: visible during loading, error and retry, client-scoped invoices, payment history, zero writes');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });

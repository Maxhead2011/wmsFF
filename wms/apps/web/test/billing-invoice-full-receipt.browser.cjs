// TEST: browser fixtures only; no server invoices or money are changed.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/HonorPC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(process.argv[2]);
const overlay = process.argv[3] ? path.resolve(process.argv[3], 'web') : null;
const user = { id: 'fixture', name: 'Константин', roleCodes: ['OWNER'], permissionCodes: ['system:admin', 'billing:read', 'billing:write'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [], activeWarehouseId: 'w', warehouseIds: ['w'], writableWarehouseIds: ['w'] };
const client = { id: 'c', code: 'CL-TEST', name: 'Тестовый клиент' };
const invoice = { id: 'invoice', number: 'TEST-FULL', clientId: 'c', client, status: 'ISSUED', serviceCategory: 'STORAGE', periodFrom: '2026-10-01', periodTo: '2026-10-02', issuedAt: '2026-10-02T10:00:00Z', createdAt: '2026-10-02T10:00:00Z', totalRub: 550535.37, paidRub: 450000, items: [], payments: [{ id: 'partial', amountRub: 450000, paidAt: '2026-10-03', status: 'RECORDED', method: 'Банк' }], comment: '' };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  const candidate = overlay && (pathname === '/' ? path.join(overlay, 'index.html') : pathname.startsWith('/assets/') ? path.join(overlay, path.basename(pathname)) : null);
  const file = candidate && fs.existsSync(candidate) ? candidate : path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!(file.startsWith(root + path.sep) || overlay && file.startsWith(overlay + path.sep)) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(user => localStorage.setItem('logoff-wms-session', JSON.stringify({ accessToken: 'fixture-only', tokenType: 'Bearer', user })), user);
    await page.route('**/api/v1/**', async route => {
      const request = route.request(), url = new URL(request.url()), pathname = url.pathname;
      let data = [];
      if (request.method() !== 'GET') {
        writes.push(pathname);
        assert.equal(pathname, '/api/v1/billing/invoices/invoice/status');
        assert.deepEqual(request.postDataJSON(), { status: 'PAID' });
        invoice.payments.push({ id: 'full', amountRub: 100535.37, paidAt: '2026-10-05', status: 'RECORDED', method: 'Банк', reference: 'FULL-CARD' });
        invoice.paidRub = invoice.totalRub;
        invoice.status = 'PAID';
        data = invoice;
      } else if (pathname.endsWith('/auth/me')) data = user;
      else if (pathname.endsWith('/branches')) data = [{ id: 'w', code: 'MSK', name: 'Москва', warehouseId: 'w', isActive: true }];
      else if (pathname.endsWith('/clients')) data = [client];
      else if (pathname.endsWith('/billing/invoices')) data = [invoice];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.getByRole('button', { name: 'Биллинг', exact: true }).click();
    await page.getByRole('row', { name: 'Открыть счёт TEST-FULL', exact: true }).click();
    const card = page.getByRole('dialog', { name: 'Карточка счёта' });
    await card.getByRole('button', { name: 'Закрыть', exact: true }).click();
    assert.equal(writes.length, 0, 'Closing the card must not record payment');
    await page.getByRole('row', { name: 'Открыть счёт TEST-FULL', exact: true }).click();
    await card.getByRole('button', { name: 'Оплачен — закрыть счёт', exact: true }).click();
    await card.getByRole('button', { name: 'Оплачен — закрыть счёт', exact: true }).waitFor({ state: 'detached' });
    assert.equal(writes.length, 1);
    assert.ok((await card.getByRole('region', { name: 'История оплат' }).innerText()).replace(/\s/g, ' ').includes('100 535,37'));
    await card.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('tab', { name: 'Приход ДС', exact: true }).click();
    await page.locator('.billing-cash-receipt__client select').selectOption('c');
    await page.getByRole('region', { name: 'История поступлений' }).getByText('FULL-CARD', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: explicit full payment, card close without payment, payment history and cash receipt history; one fixture write');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });

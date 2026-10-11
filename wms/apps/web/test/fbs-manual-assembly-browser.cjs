// TEST: actual React controls; all HTTP uses synthetic data, never real credentials.
const { strict: assert } = require('node:assert');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let creates = [], enabled = true, failOnce = true, delayed = null, hold = false;
    const rows = ['11', '12'].map(orderId => ({ orderId, skuId: 'sku', article: 'Зима_реглан_черный', size: 'M / 46', supplyId: 'WB-' + orderId,
      supplierStatus: 'confirm', wbStatus: 'waiting', free: 2, blockers: [], boxes: [
        { boxId: 'b1', boxCode: 'FFL_LKBBOX_0142', palletCode: 'PALET_SORT_1001', free: 1 },
        { boxId: 'b2', boxCode: 'FFL_LKBBOX_0143', palletCode: 'PALET_SORT_1002', free: 1 },
      ] }));
    await page.route('**/service/fbs-manual-assembly/**', async route => {
      const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
      if (endpoint === 'capabilities') return route.fulfill({ json: { enabled } });
      if (endpoint === 'options') return route.fulfill({ json: { connections: [{ id: 'cabinet', accountName: 'Кабинет TEST' }], warehouses: [{ id: 'moscow', name: 'Москва' }, { id: 'other', name: 'Другой филиал' }] } });
      if (endpoint === 'preview') {
        if (hold) await new Promise(resolve => { delayed = resolve; });
        return route.fulfill({ json: { rows, token: 'stable-token', canCreate: true, expiresAt: new Date(Date.now() + 600000).toISOString() } });
      }
      if (endpoint === 'create') {
        creates.push(route.request().postDataJSON());
        if (failOnce) { failOnce = false; return route.fulfill({ status: 503, json: { message: 'Ответ потерян' } }); }
        return route.fulfill({ json: { request: { id: 'request', number: 1922, status: 'IN_WORK' }, alreadyCreated: true } });
      }
      throw new Error('Unexpected endpoint ' + endpoint);
    });
    const url = process.env.QA_URL || 'http://127.0.0.1:5187/test/fbs-manual-assembly.html';
    await page.goto(url);
    await page.getByLabel('Номера заказов').fill('11\n12');
    await page.getByRole('button', { name: 'Проверить заказы и остатки' }).click();
    const submit = page.getByRole('button', { name: 'Создать заявку ФБС' });
    await submit.waitFor();
    assert.equal(await page.getByLabel('Короб для заказа 11').inputValue(), 'b1');
    assert.equal(await page.getByLabel('Короб для заказа 12').inputValue(), 'b2');
    await page.getByLabel('Короб для заказа 12').selectOption('b1');
    assert(await submit.isDisabled());
    await page.getByLabel('Короб для заказа 12').selectOption('b2');
    if (process.env.QA_SCREENSHOT) await page.screenshot({ path: process.env.QA_SCREENSHOT, fullPage: true });
    await submit.evaluate(button => { button.click(); button.click(); });
    await page.getByText(/Ответ потерян/).waitFor();
    assert.equal(creates.length, 1);
    await submit.click();
    await page.getByText(/Заявка №1922 уже создана/).waitFor();
    assert.deepEqual(creates[0], creates[1]);
    await page.getByLabel('Номера заказов').fill('11');
    assert.equal(await page.getByRole('table').count(), 0);
    // TEST: a stale preview cannot reappear after switching branches or leave the form busy.
    hold = true;
    await page.getByRole('button', { name: 'Проверить заказы и остатки' }).click();
    await page.waitForFunction(() => document.querySelector('textarea').disabled);
    await page.getByRole('button', { name: 'Сменить активный филиал' }).click();
    await page.getByLabel('Филиал сборки').waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    assert.equal(await page.getByLabel('Филиал сборки').inputValue(), 'other');
    assert(delayed); delayed(); hold = false;
    await page.getByRole('button', { name: 'Проверить заказы и остатки' }).click();
    await submit.waitFor();
    enabled = false; await page.goto(url);
    await page.getByText('Функция не включена или недоступна вашей роли.').waitFor();
    assert.equal(await page.getByLabel('Номера заказов').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS allocation, duplicate click, lost response retry, stale preview, branch switch, disabled feature');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

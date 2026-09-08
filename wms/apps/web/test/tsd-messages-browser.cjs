// TEST: real browser interactions against a local component and synthetic HTTP only.
const { strict: assert } = require('node:assert');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    let rows = [], fail = false, calls = [], supported = true;
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/administration/tsd-monitor/devices/*/messages', async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { supported, messages: rows } });
      const body = route.request().postDataJSON(); calls.push(body);
      if (fail) return route.fulfill({ status: 503, json: { message: 'Тест: нет связи с ВМС' } });
      const row = { id: body.requestId, text: body.text, senderName: 'Тестовый диспетчер', recipientUserId: 'test', createdAt: new Date().toISOString(), readAt: null };
      rows = [row]; return route.fulfill({ json: row });
    });
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('http://127.0.0.1:5179/test/tsd-messages.html');
      await page.getByRole('dialog').waitFor();
      assert(await page.getByRole('button', { name: 'Отправить на ТСД' }).isDisabled());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.QA_OUTPUT) await page.screenshot({ path: `${process.env.QA_OUTPUT}/messages-${width}.png` });
    }
    await page.getByRole('textbox').fill('Подойдите к упаковке');
    await page.getByRole('button', { name: 'Отправить на ТСД' }).click();
    await page.getByText('Ожидает прочтения', { exact: true }).waitFor();
    assert.equal(calls.length, 1);
    rows[0].readAt = new Date().toISOString();
    await page.getByText(/Прочитано ·/).waitFor();
    fail = true;
    await page.getByRole('textbox').fill('Повтор при обрыве сети');
    await page.getByRole('button', { name: 'Отправить на ТСД' }).click();
    await page.getByRole('alert').waitFor();
    fail = false;
    await page.getByRole('button', { name: 'Отправить на ТСД' }).click();
    await page.getByText('Ожидает прочтения', { exact: true }).waitFor();
    assert.equal(calls[1].requestId, calls[2].requestId);
    assert.equal(rows.length, 1);
    supported = false;
    await page.reload();
    await page.getByText(/Обновите приложение на этом ТСД/).waitFor();
    await page.getByRole('textbox').fill('Не отправлять');
    assert(await page.getByRole('button', { name: 'Отправить на ТСД' }).isDisabled());
    assert.deepEqual(errors, []);
    console.log('PASS: 3 viewport widths, send/read, network error, idempotent retry, old-client gate, zero page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

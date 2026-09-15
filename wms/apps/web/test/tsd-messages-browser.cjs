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

    // TEST: translation appears inside WMS; no popup, token leak or automatic TSD send.
    const original = 'Возьмите 3 товара из TEST_BOX_123 к столу 2.';
    const translated = 'Take 3 items from TEST_BOX_123 to table 2.';
    const outbound = [];
    let translationFailure = false, translationDelay = false, releaseTranslation;
    await page.context().route('https://api.mymemory.translated.net/get?**', async route => {
      outbound.push(route.request().url());
      const headers = route.request().headers();
      assert.equal(headers.authorization, undefined); assert.equal(headers.cookie, undefined); assert.equal(headers.referer, undefined);
      if (translationDelay) await new Promise(resolve => { releaseTranslation = resolve; });
      return route.fulfill({ json: translationFailure ? { responseStatus: 429 } : { responseStatus: 200, responseData: { translatedText: translated } } }).catch(() => {});
    });
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('textbox', { name: 'Текст сообщения', exact: true }).fill(original);
      await page.getByRole('button', { name: 'Перевести на', exact: true }).click();
      await page.getByLabel('Язык перевода', { exact: true }).waitFor();
      assert.equal(outbound.length, 0, 'opening the panel must not transmit anything');
      assert.equal(await page.getByLabel('Язык перевода', { exact: true }).locator('option').count(), 3);
      assert(await page.evaluate(() => document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth));
      assert(await page.getByRole('button', { name: 'Применить перевод', exact: true }).isDisabled());
      if (process.env.QA_OUTPUT) await page.screenshot({ path: `${process.env.QA_OUTPUT}/translation-${width}.png` });
      await page.getByRole('button', { name: 'Перевести на', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Перевести на', exact: true }).click();
    const translate = async () => {
      await page.getByRole('button', { name: 'Перевести', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('textarea')[1]?.value === 'Take 3 items from TEST_BOX_123 to table 2.');
    };
    for (const language of ['uz', 'en', 'ky']) {
      await page.getByLabel('Язык перевода', { exact: true }).selectOption(language);
      await translate();
      const url = new URL(outbound.at(-1));
      assert.equal(url.searchParams.get('langpair'), `ru|${language}`);
      assert.equal(url.searchParams.get('q'), original);
      assert.equal(url.searchParams.get('token'), null);
    }
    assert.equal(page.context().pages().length, 1, 'no external tab');
    assert.equal(calls.length, 3);
    await page.getByRole('textbox', { name: 'Перевод для проверки' }).fill('Take items from TRANSLATED_BOX_123 to table 2.');
    await page.getByText(/В переводе изменились коды или числа/).waitFor();
    assert(await page.getByRole('button', { name: 'Применить перевод' }).isDisabled());
    await page.getByRole('textbox', { name: 'Перевод для проверки' }).fill(translated);
    await page.getByRole('textbox', { name: 'Текст сообщения', exact: true }).fill('Изменённое сообщение');
    await page.getByText(/Исходное сообщение изменилось/).waitFor();
    assert(await page.getByRole('button', { name: 'Применить перевод' }).isDisabled());
    await page.getByRole('textbox', { name: 'Текст сообщения', exact: true }).fill(original);
    await page.getByLabel('Язык перевода', { exact: true }).selectOption('en');
    assert.equal(await page.getByRole('textbox', { name: 'Перевод для проверки' }).inputValue(), '');
    assert(await page.getByRole('button', { name: 'Применить перевод' }).isDisabled());
    // TEST: quota leaves the original intact and never exposes a partial successful result.
    translationFailure = true;
    await page.getByRole('button', { name: 'Перевести', exact: true }).click();
    await page.getByText(/Дневной лимит/).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Текст сообщения', exact: true }).inputValue(), original);
    assert(await page.getByRole('button', { name: 'Применить перевод' }).isDisabled());
    translationFailure = false;
    // TEST: double click and cancellation are safe even if a late response arrives.
    translationDelay = true;
    const before = outbound.length;
    await page.getByRole('button', { name: 'Перевести', exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.getByRole('button', { name: 'Перевожу…', exact: true }).waitFor();
    while (!releaseTranslation) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(outbound.length, before + 1);
    assert(await page.getByRole('button', { name: 'Отправить на ТСД' }).isDisabled());
    assert(await page.getByRole('textbox', { name: 'Текст сообщения', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Перевести на', exact: true }).click();
    releaseTranslation(); translationDelay = false;
    await page.getByRole('button', { name: 'Перевести на', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Перевод для проверки' }).inputValue(), '');
    await translate();
    await page.getByRole('button', { name: 'Применить перевод' }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Текст сообщения', exact: true }).inputValue(), translated);
    assert.equal(calls.length, 3, 'applying translation must not send');
    await page.getByRole('button', { name: 'Вернуть исходный текст' }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Текст сообщения', exact: true }).inputValue(), original);
    await page.getByRole('button', { name: 'Перевести на', exact: true }).click();
    await translate();
    await page.getByRole('button', { name: 'Применить перевод' }).click();
    await page.getByRole('button', { name: 'Отправить на ТСД' }).click();
    await page.getByRole('textbox', { name: 'Текст сообщения', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('textarea').value === '');
    assert.equal(calls[3].text, translated);
    assert.equal(await page.getByRole('button', { name: 'Вернуть исходный текст' }).count(), 0);
    supported = false;
    await page.reload();
    await page.getByText(/Обновите приложение на этом ТСД/).waitFor();
    await page.getByRole('textbox').fill('Не отправлять');
    assert(await page.getByRole('button', { name: 'Отправить на ТСД' }).isDisabled());
    assert.deepEqual(errors, []);
    // TEST: opt-in live-provider smoke sends synthetic text only, never a message to a real TSD.
    if (process.env.LIVE_TRANSLATION === '1') {
      supported = true; await page.reload();
      await page.context().unroute('https://api.mymemory.translated.net/get?**');
      const sendCount = calls.length;
      await page.getByRole('textbox', { name: 'Текст сообщения', exact: true }).fill('Подойдите к столу упаковки.');
      await page.getByRole('button', { name: 'Перевести на', exact: true }).click();
      for (const language of ['uz', 'en', 'ky']) {
        await page.getByLabel('Язык перевода', { exact: true }).selectOption(language);
        await page.getByRole('button', { name: 'Перевести', exact: true }).click();
        await page.waitForFunction(() => !!document.querySelectorAll('textarea')[1]?.value, null, { timeout: 35000 });
        const value = await page.getByRole('textbox', { name: 'Перевод для проверки' }).inputValue();
        assert(value.trim() && value !== 'Подойдите к столу упаковки.');
        assert(await page.getByRole('button', { name: 'Применить перевод' }).isEnabled());
        await page.getByRole('textbox', { name: 'Перевод для проверки' }).scrollIntoViewIfNeeded();
        if (process.env.QA_OUTPUT) await page.screenshot({ path: `${process.env.QA_OUTPUT}/live-translation-${language}.png` });
        console.log(`LIVE ${language}: ${value}`);
      }
      assert.equal(calls.length, sendCount); assert.equal(page.context().pages().length, 1);
      assert.deepEqual(errors, []);
    }
    console.log('PASS: 3 viewport widths, send/read, network error, idempotent retry, inline translation for 3 languages, no popup/credentials/automatic transmission, code/number validation, stale draft, quota, double click, cancellation, undo, explicit translated send, old-client gate, zero page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

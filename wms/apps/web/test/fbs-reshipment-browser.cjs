// TEST: actual React interactions with synthetic HTTP, no remote writes or credentials.
const { strict: assert } = require('node:assert');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    const order = { id: '123', connectionId: 'cabinet', sourceRequestNumber: 712, sourceSupplyId: 'WB-GI-old',
      productName: 'Тестовый костюм', article: 'S', barcode: '205', assemblyStatus: 'COMPLETED',
      supplierStatus: 'complete', wbStatus: 'waiting', eligibleModes: ['SAME_ITEM', 'NEW_ITEM'], blockedReason: null };
    let enabled = true, runs = [], createCalls = [], failCreate = false, delayed = null, blockCheck = false;
    const created = { runId: 'run-1', status: 'CREATED', mode: 'SAME_ITEM', supplyId: 'WB-GI-new', requestId: 'req-1', requestNumber: 713, errorMessage: null };
    await page.route('**/marketplace-connections/fbs/reshipment/**', async route => {
      const endpoint = route.request().url().split('/').at(-1);
      if (endpoint === 'capabilities') return route.fulfill({ json: { enabled } });
      if (endpoint === 'check') {
        if (blockCheck) await new Promise(resolve => { delayed = resolve; });
        return route.fulfill({ json: { candidates: [order, { ...order, id: 'blocked', eligibleModes: [], blockedReason: 'Сначала распакуйте грузокороб' }], runs, unverifiedCount: 2 } });
      }
      const body = route.request().postDataJSON();
      if (endpoint === 'preview') return route.fulfill({ json: { previewToken: 'signed-proof', orders: [order], orderCount: 1, additionalUnits: body.mode === 'NEW_ITEM' ? 1 : 0, warning: 'Проверка WB выполнена' } });
      if (endpoint === 'create') { createCalls.push(body);
        if (failCreate) { runs = [{ ...created, status: 'NEEDS_RECONCILIATION', requestId: null, requestNumber: null }]; return route.fulfill({ status: 503, json: { message: 'Обрыв ответа' } }); }
        runs = [created]; return route.fulfill({ json: created });
      }
      if (endpoint === 'resume') { runs = [created]; return route.fulfill({ json: created }); }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:5181/test/fbs-reshipment.html');
    await page.getByRole('button', { name: 'Проверить WB', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Выбрать заказ 123 кабинета cabinet' }).waitFor();
    assert.equal(createCalls.length, 0);
    assert(await page.getByRole('checkbox', { name: 'Выбрать заказ blocked кабинета cabinet' }).isDisabled());
    // TEST: real filter controls, bulk selection and invalidation; no hidden selections.
    await page.getByText(/Статус WB не подтверждён: 2/).waitFor();
    await page.getByLabel('Кабинет WB', { exact: true }).selectOption('cabinet');
    await page.getByLabel('Доступность для выбранного действия').selectOption('REVIEW');
    assert.equal(await page.getByRole('checkbox', { name: 'Выбрать заказ 123 кабинета cabinet' }).count(), 0);
    assert(await page.getByRole('button', { name: 'Выбрать все доступные по фильтру' }).isDisabled());
    await page.getByLabel('Доступность для выбранного действия').selectOption('AVAILABLE');
    await page.getByLabel('Поиск по заказу, заявке, поставке, ШК или товару').fill('712 костюм');
    await page.getByRole('button', { name: 'Выбрать все доступные по фильтру' }).click();
    assert(await page.getByRole('checkbox', { name: 'Выбрать заказ 123 кабинета cabinet' }).isChecked());
    await page.getByRole('button', { name: 'Снять выбор', exact: true }).click();
    assert(!(await page.getByRole('checkbox', { name: 'Выбрать заказ 123 кабинета cabinet' }).isChecked()));
    await page.getByRole('button', { name: 'Выбрать все доступные по фильтру' }).click();
    await page.getByLabel('Поиск по заказу, заявке, поставке, ШК или товару').fill('нет совпадений');
    await page.getByText('По выбранным фильтрам заказов нет.', { exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Проверить выбранные · 0' }).isDisabled());
    await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Выбрать заказ 123 кабинета cabinet' }).check();
    await page.getByRole('button', { name: 'Проверить выбранные · 1' }).click();
    const submit = page.getByRole('button', { name: 'Создать поставку WB и заявку WMS' });
    assert(await submit.isDisabled());
    await page.getByRole('radio', { name: 'Собрать заново', exact: true }).check();
    assert.equal(await submit.count(), 0);
    await page.getByRole('button', { name: 'Выбрать все доступные по фильтру' }).click();
    await page.getByRole('button', { name: 'Проверить выбранные · 1' }).click();
    await page.getByText('Заказов: 1. Дополнительный расход: 1 ед.', { exact: true }).waitFor();
    await page.getByRole('checkbox', { name: /Подтверждаю изменения в WB/ }).check();
    await submit.evaluate(button => { button.click(); button.click(); });
    await page.getByText(/Заявка создана/).waitFor();
    assert.equal(createCalls.length, 1); assert.equal(createCalls[0].mode, 'NEW_ITEM'); assert.equal(createCalls[0].confirm, true);
    failCreate = true;
    await page.getByRole('button', { name: 'Проверить WB', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Выбрать заказ 123 кабинета cabinet' }).check();
    await page.getByRole('button', { name: 'Проверить выбранные · 1' }).click();
    await page.getByRole('checkbox', { name: /Подтверждаю изменения в WB/ }).check(); await submit.click();
    await page.getByRole('alert').filter({ hasText: 'Результат создания неизвестен' }).waitFor(); assert.equal(await submit.count(), 0);
    await page.getByRole('button', { name: 'Проверить WB', exact: true }).click();
    await page.getByRole('button', { name: 'Проверить и продолжить сохранённую операцию' }).click();
    await page.getByText(/Заявка создана/).waitFor(); assert.equal(createCalls.length, 2);
    for (const change of ['Сменить клиента', 'Сменить филиал', 'Сменить сотрудника']) {
      blockCheck = true; delayed = null;
      await page.getByRole('button', { name: 'Проверить WB', exact: true }).click();
      await page.getByText('Выполняется операция…', { exact: true }).waitFor();
      await page.getByRole('button', { name: change, exact: true }).click();
      blockCheck = false; delayed?.();
      await page.getByRole('button', { name: 'Проверить WB', exact: true }).waitFor();
      assert.equal(await page.getByRole('checkbox', { name: 'Выбрать заказ 123 кабинета cabinet' }).count(), 0);
    }
    enabled = false; await page.reload();
    await page.getByRole('button', { name: 'Сменить клиента', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Проверить WB', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: filters, bulk selection, hidden selection invalidation, status warning, StrictMode, WB-only check, disabled reason, confirmation, mode invalidation, double click, durable resume, client/branch/user isolation, feature off.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

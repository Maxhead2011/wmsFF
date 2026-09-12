// TEST: verify confirmation, forbidden target, failed deletion, success and disappearance from the list.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXE ? { executablePath: process.env.BROWSER_EXE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let deletes = 0, fail = true;
    const users = [{ id: 'employee', name: 'Иван Сотрудник', email: 'ivan@example.test', canDelete: true },
      { id: 'admin', name: 'Анна Администратор', email: 'anna@example.test', canDelete: false }].map(user => ({
      ...user, status: 'ACTIVE', roles: [{ role: { code: user.id === 'admin' ? 'ADMIN' : 'OPERATOR', name: user.id === 'admin' ? 'Администратор' : 'Оператор' } }],
      warehouseScopes: [{ warehouse: { id: 'moscow', name: 'ФФ Москва' }, canRead: true, canWrite: true }],
    }));
    await page.route('**/api/v1/**', route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (request.method() === 'GET' && path.endsWith('/users')) return json(users);
      if (request.method() === 'DELETE' && path.endsWith('/users/employee')) {
        deletes++; return fail ? json({ message: 'Права изменились. Обновите список.' }, 403) : json({ id: 'employee', status: 'ARCHIVED' });
      }
      throw new Error(`Unexpected request ${request.method()} ${path}`);
    });
    await page.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:5189') + '/test/user-delete.html');
    await page.getByRole('button', { name: /Пользователи.*Удаление пользователей/ }).click();
    await page.getByRole('combobox').selectOption('admin');
    assert.equal(await page.getByRole('button', { name: 'Удалить пользователя', exact: true }).count(), 0);
    await page.getByRole('combobox').selectOption('employee');
    await page.getByRole('button', { name: 'Удалить пользователя', exact: true }).click();
    await page.getByRole('dialog').getByText(/Иван Сотрудник.*ivan@example.test/).waitFor();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click(); assert.equal(deletes, 0);
    await page.getByRole('button', { name: 'Удалить пользователя', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить пользователя', exact: true }).click();
    await page.getByRole('dialog').getByText('Права изменились. Обновите список.', { exact: true }).waitFor(); assert.equal(deletes, 1);
    assert.equal(await page.locator('option[value="employee"]').count(), 1);
    fail = false;
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить пользователя', exact: true }).click();
    await page.getByRole('status').waitFor(); assert.equal(deletes, 2);
    assert.equal(await page.locator('option[value="employee"]').count(), 0);
    assert.deepEqual(errors, []);
    if (process.env.TEST_SCREENSHOT) await page.screenshot({ path: process.env.TEST_SCREENSHOT, fullPage: true });
    console.log('USER_DELETE_BROWSER_PASSED');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

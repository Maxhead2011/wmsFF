// TEST: real application navigation and monitoring data for ADMIN and owner.
// Run against Vite with VITE_ADMIN_MONITORING_ENABLED=true; all API calls are mocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXE ? { executablePath: process.env.BROWSER_EXE } : {}) });
  try {
    for (const owner of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      const actor = { id: 'qa', name: 'QA', email: 'qa@example.test', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], administrationEnabled: owner, isDemo: false, workspaceVisibility: { monitoring: false }, clientScopeMode: 'ALL', clientIds: [], writableClientIds: [], activeWarehouseId: 'moscow', warehouseIds: ['moscow'], writableWarehouseIds: ['moscow'] };
      await page.addInitScript(actor => localStorage.setItem('logoff-wms-session', JSON.stringify({ accessToken: 'mock-only', tokenType: 'Bearer', user: actor })), actor);
      let monitorRequests = 0;
      await page.route('**/api/v1/**', route => {
        const path = new URL(route.request().url()).pathname;
        const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        if (path.endsWith('/auth/me')) return json(actor);
        if (path.endsWith('/branches')) return json([{ id: 'moscow', name: 'ФФ Москва', code: 'MSK', isActive: true }]);
        if (path.endsWith('/administration/tsd-monitor')) {
          monitorRequests++;
          return json({ checkedAt: new Date().toISOString(), summary: { onlineDevices: 1, busyDevices: 0, tasks: 0, errors24h: 0 }, devices: [{ deviceCode: 'QA-TSD', deviceName: 'Проверочный ТСД', online: true, user: { name: 'Сборщик QA' }, lastSeenAt: new Date().toISOString(), workloads: [], errors: [], activity: [], liveState: null }], pickerStatistics: { period: { label: 'Сегодня' }, summary: { workers: 0, orders: 0, units: 0 }, workers: [] } });
        }
        return json([]);
      });
      await page.route('**/downloads/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
      await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5190');
      await page.getByRole('button', { name: 'Мониторинг', exact: true }).click();
      await page.getByText('Сборщик QA', { exact: true }).waitFor();
      assert(monitorRequests > 0);
      assert.equal(await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).count(), owner ? 1 : 0);
      assert.equal(await page.getByRole('button', { name: 'Снять все задания', exact: true }).count(), owner ? 1 : 0);
      assert.equal(await page.getByRole('button', { name: 'Сообщение', exact: true }).count(), owner ? 1 : 0);
      assert.deepEqual(errors, []);
      if (!owner && process.env.TEST_SCREENSHOT) await page.screenshot({ path: process.env.TEST_SCREENSHOT, fullPage: true });
      await context.close();
    }
    console.log('ADMIN_MONITORING_BROWSER_PASSED');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

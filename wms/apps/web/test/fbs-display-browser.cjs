// TEST: real FbsPanel, synthetic API only; no production cookies, keys or writes.
const { strict: assert } = require('node:assert');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const client = { id: 'qa-client', code: 'QA', name: 'Тестовый кабинет' };
const connection = { id: 'qa-connection', marketplace: 'WILDBERRIES', accountName: 'QA WB' };
const order = { id: '1234567890', connectionId: connection.id, marketplace: 'WILDBERRIES',
  category: 'active', supplierStatus: 'confirm', wbStatus: 'waiting', statusLabel: 'На сборке',
  accountName: 'QA WB', article: 'QA-SUIT', product: { id: 'qa-sku', name: 'Тестовый костюм', article: 'QA-SUIT', size: 'M' },
  barcodes: ['1234567890123'], storageBoxes: [], itemCount: 1, createdAt: '2026-09-16T07:00:00Z',
  supplyId: 'WB-GI-QA', requiredMeta: [], optionalMeta: [], billing: null };
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [375, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [], unexpected = [], reads = [];
      let phase = 'cold';
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1') { unexpected.push('external request'); return route.abort(); }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        assert.equal(route.request().method(), 'GET', 'QA must never mutate data');
        const sync = { partial: phase === 'cold', refreshing: phase === 'cold', lastSuccessAt: phase === 'cold' ? null : '2026-09-16T10:00:00Z',
          error: phase === 'error' ? 'Маркетплейс отклонил доступ. Проверьте API-ключ кабинета.' : null };
        let json;
        if (url.pathname === '/api/v1/clients') json = [client];
        else if (url.pathname.endsWith('/fbs/active-clients')) {
          assert.equal(url.searchParams.get('view'), 'snapshot');
          json = url.searchParams.get('marketplace') === 'WILDBERRIES' ? [{ client, activeOrders: phase === 'cold' ? 0 : 1, fetchedAt: sync.lastSuccessAt ?? '', sync }] : [];
        } else if (url.pathname.endsWith('/fbs/orders')) {
          assert.equal(url.searchParams.get('view'), 'snapshot'); reads.push(phase);
          if (phase === 'network-error') return route.fulfill({ status: 503, json: { message: 'Тестовый временный сбой' } });
          json = { client, connected: true, connections: [connection], fetchedAt: sync.lastSuccessAt ?? '', sync,
            deliveryPlan: { destination: 'PICKUP_POINT', itemsPerCargoPlace: 2000000000, requiresCargoPlaces: true },
            orders: phase === 'cold' ? [] : [order], counts: { active: phase === 'cold' ? 0 : 1, shipped: 0, cancelled: 0, archive: 0, all: phase === 'cold' ? 0 : 1 } };
        } else if (url.pathname.endsWith('/fbs/reshipment/capabilities')) json = { enabled: false, allowed: false };
        else if (url.pathname.endsWith('/fbs/cargo-packings')) json = { supplies: [] };
        else { unexpected.push(url.pathname); json = []; }
        return route.fulfill({ status: 200, json });
      });
      await page.goto('http://127.0.0.1:5179/test/fbs-display.html');
      await page.getByRole('button', { name: /Wildberries/ }).first().click();
      await page.getByText('Полный список заказов ещё не загружен.', { exact: false }).waitFor();
      assert(await page.getByText('Тестовый кабинет', { exact: true }).count() > 0);
      phase = 'ready';
      // The existing UI intentionally keeps supply groups collapsed until the user opens one.
      await page.getByRole('button', { name: 'Развернуть группу заказов' }).first().click({ timeout: 12000 });
      await page.getByText('Тестовый костюм', { exact: true }).first().waitFor({ timeout: 12000 }).catch(async error => {
        console.error({ reads, errors, unexpected, body: (await page.locator('body').innerText()).slice(-5500) });
        throw error;
      });
      assert(reads.includes('ready'), 'automatic polling did not collect completed refresh');
      phase = 'error';
      await page.getByRole('button', { name: /^Обновить$/ }).click();
      await page.getByRole('alert').filter({ hasText: 'API-ключ' }).first().waitFor();
      assert(await page.getByText('Тестовый костюм', { exact: true }).count() > 0, 'stale row disappeared');
      phase = 'network-error';
      await page.getByRole('button', { name: /^Обновить$/ }).click();
      await page.getByText('Тестовый временный сбой', { exact: false }).waitFor();
      assert(await page.getByText('Тестовый костюм', { exact: true }).count() > 0, 'HTTP failure erased cached row');
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      if (process.env.QA_OUTPUT) await page.screenshot({ path: `${process.env.QA_OUTPUT}/fbs-${width}.png`, fullPage: true });
      console.log(`PASS FBS ${width}px: cold start, background completion, WB error, retained rows on HTTP failure`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

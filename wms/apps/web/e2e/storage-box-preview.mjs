// TEST: actual pallet screen + real popup, mocked read-only API, no production credentials.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const output = process.env.PREVIEW_ARTIFACT_DIR;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 22954, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Preview page error:', error.message); });
  const client = { id: 'client-1', code: 'TEST', name: 'Тестовый клиент', status: 'ACTIVE' };
  const rows = Array.from({ length: 20 }, (_, i) => ({ balanceId: `b-${i}`, skuId: `sku-${i}`, name: `Костюм ${i + 1}`,
    article: 'Лаунж', color: 'Серый', size: 'M / 46', barcode: `0012345678${String(i).padStart(3, '0')}`,
    quantity: 2, statusLabel: 'Доступно', status: 'AVAILABLE', kiz: [] }));
  const layout = { warehouse: { id: 'warehouse-1', name: 'Тестовый склад' }, zones: [], googleSync: { error: null },
    codePrefixes: { pallet: 'PALET_SORT_', storageCell: 'CELL_', rackSlot: 'SLOT_', rack: 'RACK_', storageBox: 'FFL_BOX_' },
    summary: { zones: 0, pallets: 1, boxes: 3, unassignedPallets: 1 },
    pallets: [{ id: 'pallet-1', code: 'PALET_SORT_TEST', clientId: client.id, client, warehouseId: 'warehouse-1', status: 'OPEN', source: 'TSD', zoneId: null,
      boxes: ['BOX-1', 'BOX-2', 'BOX-MISSING'].map((code, i) => ({ id: `placement-${i}`, boxCode: code, boxId: i === 2 ? null : code,
        source: 'TSD', scannedAt: '2026-09-05', box: i === 2 ? null : { id: code, status: 'active', client } })) }] };
  let calls = 0; let failed = false;
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    assert.equal(request.method(), 'GET', 'Preview must not mutate WMS');
    const url = new URL(request.url());
    if (url.pathname.endsWith('/clients')) return route.fulfill({ json: [client] });
    if (url.pathname.includes('/warehouse/storage-locations')) return route.fulfill({ json: layout });
    if (url.pathname.includes('/turnover/boxes/')) {
      calls += 1; assert.equal(url.searchParams.get('clientId'), client.id);
      if (failed) return route.fulfill({ status: 403, json: { message: 'Нет доступа к коробу' } });
      const code = decodeURIComponent(url.pathname.split('/').pop());
      return route.fulfill({ json: { box: { code, client }, totals: { quantity: code === 'BOX-1' ? 40 : 0 }, contents: code === 'BOX-1' ? rows : [] } });
    }
    throw new Error(`Unexpected API request ${url.pathname}`);
  });
  await page.goto('http://127.0.0.1:22954/e2e/storage-box-preview.html');
  await page.getByRole('button', { name: /PALET_SORT_TEST/ }).click();
  const first = page.getByRole('button', { name: 'Товары в коробе BOX-1', exact: true });
  assert.equal(calls, 0, 'Opening pallet must not load all box contents');
  await first.hover();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor(); await dialog.getByText('Костюм 20', { exact: true }).waitFor();
  assert.equal(calls, 1); assert.equal(await dialog.locator('li').count(), 20);
  await dialog.hover();
  const body = dialog.getByLabel('Перечень товаров');
  assert.ok(await body.evaluate(el => el.scrollHeight > el.clientHeight), 'Long contents must scroll');
  await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.ok(await body.evaluate(el => el.scrollTop > 0));
  if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: resolve(output, 'desktop.png') }); }
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  await first.focus(); await dialog.waitFor();
  // TEST: hovering another box must replace even a keyboard-opened preview, not stack dialogs.
  await page.getByRole('button', { name: 'Товары в коробе BOX-MISSING', exact: true }).hover();
  await dialog.getByText('Короб не найден в WMS. Состав недоступен.').waitFor();
  assert.equal(await dialog.count(), 1);
  await first.hover(); await dialog.getByText('Костюм 1', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Закрыть состав короба' }).click();
  await dialog.waitFor({ state: 'hidden' }); assert.ok(await first.evaluate(el => document.activeElement === el));
  await first.blur();
  const second = page.getByRole('button', { name: 'Товары в коробе BOX-2', exact: true });
  await second.hover(); await dialog.getByText('По данным WMS в коробе нет товаров.').waitFor();
  assert.equal(await dialog.locator('li').count(), 0, 'Previous box contents must not leak');
  await page.keyboard.press('Escape');
  failed = true; await first.hover(); await dialog.getByRole('alert').waitFor();
  assert.ok((await dialog.innerText()).includes('Нет доступа'));
  failed = false; await dialog.getByRole('button', { name: 'Повторить загрузку' }).click(); await dialog.getByText('Костюм 1', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  const callsBeforeMissing = calls;
  await page.getByRole('button', { name: 'Товары в коробе BOX-MISSING', exact: true }).hover();
  await dialog.getByText('Короб не найден в WMS. Состав недоступен.').waitFor(); assert.equal(calls, callsBeforeMissing);
  await page.keyboard.press('Escape');
  await page.locator('main.app-layout').evaluate(el => { el.dataset.uiVariant = 'obsidian'; });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 }); await first.click(); await dialog.getByText('Костюм 1', { exact: true }).waitFor();
    const rect = await dialog.boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0 && rect.y + rect.height <= 800);
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(17, 27, 37)');
    if (output) await page.screenshot({ path: resolve(output, `dark-${width}.png`) });
    await page.keyboard.press('Escape'); await first.blur();
  }
  assert.equal(await page.getByTitle('Перенести или поменять короб местами').count(), 3);
  assert.equal(await page.getByTitle('Убрать короб с паллеты', { exact: true }).count(), 3);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', scope: 'real StorageZonesPanel, mocked API', breakpoints: [375, 768, 1440],
    checks: ['lazy hover', 'all 20 rows', 'scroll', 'Escape', 'keyboard focus', 'empty box', 'no stale box data', 'error/retry', 'missing box', 'theme', 'viewport bounds', 'unchanged actions'], requests: calls }));
} finally { await browser.close(); await server.close(); }

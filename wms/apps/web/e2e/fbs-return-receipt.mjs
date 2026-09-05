// TEST: real return dialog, synthetic data only; no WMS or marketplace writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 22956, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || url.pathname.includes('/api/')) throw new Error(`Unexpected network ${url.pathname}`);
    return route.continue();
  });
  await page.goto('http://127.0.0.1:22956/e2e/fbs-return-receipt.html');
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const box = page.getByLabel('Бокс назначения');
  const barcode = page.getByLabel('ШК товара', { exact: true });
  const kiz = page.getByLabel('КИЗ товара', { exact: true });
  assert.equal(await box.inputValue(), ''); assert.equal(await kiz.inputValue(), '');
  assert.ok(await page.getByRole('button', { name: 'Принять в бокс', exact: true }).isDisabled());
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const rect = await dialog.boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0 && rect.y + rect.height <= 800);
    if (process.env.PREVIEW_ARTIFACT_DIR) {
      await mkdir(process.env.PREVIEW_ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(process.env.PREVIEW_ARTIFACT_DIR, `return-${width}.png`) });
    }
  }
  await box.fill('FFL_LKBBOX_TEST'); await box.press('Enter');
  assert.ok(await barcode.evaluate(el => el === document.activeElement));
  await barcode.fill('0012345678901'); await barcode.press('Enter');
  assert.ok(await kiz.evaluate(el => el === document.activeElement));
  await kiz.fill('TEST-MARK-CaseSensitive'); await kiz.press('Enter');
  await page.getByRole('button', { name: 'Принимаю…' }).waitFor();
  // Same-tick and delayed repeated submissions must not create a second receipt.
  await page.locator('form').evaluate(form => {
    for (let i = 0; i < 3; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(await page.evaluate(() => window.receipts.length), 1);
  assert.ok(await box.isDisabled());
  await page.keyboard.press('Escape'); assert.ok(await dialog.isVisible());
  await page.evaluate(() => window.finishReceipt('Тестовая ошибка: остатки не изменены.'));
  await dialog.getByRole('alert').waitFor();
  assert.equal(await barcode.inputValue(), '0012345678901');
  await page.getByRole('button', { name: 'Принять в бокс', exact: true }).click();
  assert.equal(await page.evaluate(() => window.receipts.length), 2);
  await page.evaluate(() => window.finishReceipt(''));
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Открыть тест' }).click();
  assert.equal(await box.inputValue(), ''); assert.equal(await kiz.inputValue(), '');
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('PASS: empty scans, keyboard flow, 3 viewport bounds, duplicate-submit guard, busy lock, error/retry, reset, Escape; mocked local harness only.');
} finally { await browser?.close(); await server.close(); }

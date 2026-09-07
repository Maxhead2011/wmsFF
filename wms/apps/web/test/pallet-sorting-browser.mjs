import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.env.SORTING_QA_OUTPUT || join(root, 'test-results/pallet-sorting');
await mkdir(out, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5197, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push(e.message));
let state = null, moves = 0, writeoffs = 0, simulateLostReply = true, loseWriteoffReply = true;
const commands = new Map();
const snapshot = () => ({ fingerprint: `snapshot-${state.version}`, quantity: 1,
  affectedOrders: ['QA-ORDER'], boxes: [{ id: state.stage === 'CHECKING' ? 'b' : 'a', code: state.stage === 'CHECKING' ? 'QA-SOURCE-B' : 'QA-SOURCE-A', preserveOnPallet: state.stage === 'CHECKING', balances: Array.from({ length: 35 }, (_, i) => ({ id: `row-${i}`, quantity: i === 0 ? 1 : 0, sku: { article: `QA-SKU-${i}`, name: 'Тестовый костюм', size: '44', color: 'Синий' } })) }] });
await page.route('**/api/v1/pallet-sorting**', async route => {
  const req = route.request(), url = new URL(req.url()), body = req.method() === 'POST' ? req.postDataJSON() : null;
  let data, status = 200;
  if (url.pathname.endsWith('/preview')) data = snapshot();
  else if (req.method() === 'GET') data = /\/pallet-sorting$/.test(url.pathname) ? (state && state.stage !== 'COMPLETED' ? [state] : []) : state;
  else if (url.pathname.endsWith('/routes')) { state.pendingRoutes = []; state.version++; data = state; }
  else if (!body.action) {
    state = { id: body.id, version: 1, sourceCode: body.code, stage: 'CHECKING', targets: [], moves: [], pendingRoutes: [],
      sources: [{ id: 'a', code: 'QA-SOURCE-A', scanned: false, archived: false }, { id: 'b', code: 'QA-SOURCE-B', scanned: false, archived: false }] }; data = state;
  } else if (commands.has(body.operationId)) data = state;
  else {
    if (body.action === 'SCAN_SOURCE') state.sources.find(b => b.code === body.code).scanned = true;
    if (body.action === 'ARCHIVE_MISSING' || body.action === 'COMPLETE') {
      assert.equal(body.fingerprint, `snapshot-${state.version}`); assert.equal(body.confirmWriteOff, true);
      writeoffs++;
      state.sources.forEach(b => {
        if (b.preservedOnPallet) return;
        if (b.id === 'b') b.preservedOnPallet = true;
        else if (body.action === 'COMPLETE') b.archived = true;
      });
      if (body.action === 'COMPLETE') state.stage = 'COMPLETED';
    }
    if (body.action === 'BEGIN_FORMING') state.stage = 'FORMING';
    if (body.action === 'OPEN_TARGET') { assert.equal(body.palletCode, 'QA-TARGET-PALLET'); state.targets.push({ id: 'target', code: body.code, palletCode: body.palletCode, quantity: 0, closed: false }); state.activeTargetId = 'target'; }
    if (body.action === 'CLOSE_TARGET') { state.targets[0].closed = true; state.activeTargetId = null; }
    if (body.action === 'MOVE') {
      if (body.kiz === 'INVALID') { status = 400; data = { message: 'Неверный КИЗ' }; }
      else { moves++; state.moves.push({ identity: body.kiz }); state.targets[0].quantity++; state.pendingRoutes = [{ requestId: 'qa-request', taskIds: ['qa-task'] }]; }
    }
    if (status === 200) {
      state.version++; commands.set(body.operationId, true); data = state;
      // TEST: server applied the unit but its response was lost.
      if (body.action === 'MOVE' && simulateLostReply) { simulateLostReply = false; await route.abort('failed'); return; }
      if (body.action === 'ARCHIVE_MISSING' && loseWriteoffReply) { loseWriteoffReply = false; await route.abort('failed'); return; }
    }
  }
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
});
const wait = async fn => { for (let i = 0; i < 60; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Expected UI state did not appear'); };
const scan = async (label, value) => { await page.getByRole('textbox', { name: label, exact: true }).fill(value); await page.getByRole('textbox', { name: label, exact: true }).press('Enter'); };
try {
  await page.goto('http://127.0.0.1:5197/test/pallet-sorting-fixture.html');
  await scan('Паллет-сорт или короб', 'QA-PALLET');
  await scan('Исходный короб на паллет-сорте', 'QA-SOURCE-A');
  await page.getByRole('button', { name: 'Расхождения по коробам: 1' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Применить решение и списать недостачу' }).isEnabled(), false);
  assert.match(await dialog.textContent(), /Постоянных боксов: 1/);
  assert.equal(await page.getByRole('button', { name: 'Подтвердить скан', exact: true }).isEnabled(), false);
  const table = page.locator('.pallet-sorting-table');
  assert.equal(await table.evaluate(e => e.scrollHeight > e.clientHeight), true);
  await table.hover(); await page.mouse.wheel(0, 600);
  await wait(() => table.evaluate(e => e.scrollTop > 0));
  await page.screenshot({ path: join(out, 'desktop-discrepancies.png') });
  await dialog.getByRole('button', { name: 'Отмена — ничего не списывать' }).click();
  assert.equal(writeoffs, 0);
  await page.getByRole('button', { name: 'Расхождения по коробам: 1' }).click();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Применить решение и списать недостачу' }).click();
  // TEST: uncertain write-off can be retried without escaping the modal or writing off twice.
  await dialog.getByRole('button', { name: 'Повторить тот же запрос' }).click({ timeout: 2500 });
  assert.equal(writeoffs, 1);
  // TEST: a settled permanent box is not labelled archived and does not block the next stage.
  await page.getByText('QA-SOURCE-B — пустой бокс · сохранён на месте', { exact: true }).waitFor({ state: 'attached', timeout: 2500 });
  await page.getByRole('button', { name: 'Приступить к формированию новых коробов' }).click();
  await page.getByRole('textbox', { name: 'Фактический паллет-сорт целевого короба' }).fill('QA-TARGET-PALLET');
  await scan('Новый целевой короб', 'QA-TARGET');
  await scan('ШК товара', '2000000000001');
  await scan('КИЗ товара', 'INVALID');
  await wait(() => page.getByRole('status').textContent().then(t => t?.includes('Неверный КИЗ')));
  assert.equal(await page.getByRole('textbox', { name: 'КИЗ товара', exact: true }).inputValue(), '');
  await scan('КИЗ товара', '0104600000000000215a00000000001');
  await page.getByRole('button', { name: 'Повторить тот же запрос' }).click();
  await wait(() => page.getByRole('textbox', { name: 'ШК товара', exact: true }).isEnabled());
  assert.equal(moves, 1);
  await page.reload();
  await page.getByRole('button', { name: 'QA-PALLET · 1 ед.' }).click();
  await page.getByRole('button', { name: 'Закрыть короб', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Завершить сортировку', exact: true }).click();
  await dialog.waitFor();
  // TEST: narrow screens scroll the table horizontally without overflowing the page.
  assert.equal(await table.evaluate(e => e.scrollWidth > e.clientWidth), true);
  await table.hover(); await page.mouse.wheel(450, 0);
  await wait(() => table.evaluate(e => e.scrollLeft > 0));
  await page.screenshot({ path: join(out, 'mobile-discrepancies.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Применить решение и списать недостачу' }).click();
  await page.getByRole('heading', { name: 'QA-PALLET · Сортировка завершена' }).waitFor();
  assert.equal(writeoffs, 2); assert.equal(moves, 1); assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({ result: 'PASS', scenario: 'source scan, consent cancel/accept, native modal, wheel scroll, invalid KIZ clear, lost-response retry, reload/resume, close vs complete, 375px layout', moves, writeoffs, consoleErrors, screenshots: out }));
} finally { await browser.close(); await server.close(); }

// TEST: exercise the real CSS cascade in Chromium, including legacy Modern rules.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const src = path.resolve(__dirname, '../apps/web/src');
test('Dark surfaces stay dark and readable; Light remains light', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html data-ui-theme="modern" data-ui-variant="la_panthera" data-ui-style="dark"><body><main class="app-layout" data-ui-theme="modern" data-ui-variant="la_panthera"><section class="fbs-panel">FBS</section><section class="catalog-panel">Catalog</section><section class="client-cabinet-panel"><section class="client-product-display">Settings</section></section><div class="order-assembly__status">Ready</div><div class="order-assembly__status is-ok">Success</div></main></body></html>`);
    if (process.env.LIVE_CSS_FILE) {
      await page.addStyleTag({ content: fs.readFileSync(path.join(src, 'components/directories/directories.css'), 'utf8') });
      for (const content of JSON.parse(fs.readFileSync(process.env.LIVE_CSS_FILE, 'utf8'))) await page.addStyleTag({ content });
      const theme = fs.readFileSync(path.join(src, 'components/layout/la-panthera-theme.css'), 'utf8');
      await page.addStyleTag({ content: theme.slice(theme.indexOf('/* FIX: Dark must override')) });
    } else for (const file of ['styles.css', 'components/fbs/fbs.css', 'components/catalog/catalog.css', 'components/client-cabinet/client-cabinet.css', 'components/layout/la-panthera-theme.css', 'components/layout/la-panthera-light.css']) {
      await page.addStyleTag({ content: fs.readFileSync(path.join(src, file), 'utf8') });
    }
    const selectors = ['.fbs-panel', '.catalog-panel', '.client-cabinet-panel', '.order-assembly__status'];
    for (const selector of selectors) {
      const colors = await page.locator(selector).first().evaluate(el => { const s = getComputedStyle(el); return { bg: s.backgroundColor, fg: s.color }; });
      assert.equal(colors.bg, 'rgb(25, 26, 30)', selector);
      assert.equal(colors.fg, 'rgb(243, 243, 246)', selector);
    }
    assert.equal(await page.locator('.client-product-display').evaluate(el => getComputedStyle(el).color), 'rgb(243, 243, 246)');
    assert.deepEqual(await page.locator('.is-ok').evaluate(el => { const s = getComputedStyle(el); return [s.backgroundColor, s.color]; }), ['rgb(25, 53, 42)', 'rgb(123, 222, 176)']);
    // TEST: relabel labels and controls occupy separate rows at desktop/mobile widths.
    await page.addStyleTag({ content: fs.readFileSync(path.join(src, 'components/directories/directories.css'), 'utf8') });
    await page.locator('main').evaluate(el => el.insertAdjacentHTML('beforeend', '<form class="directory-fields relabel-product-form"><label><span>Исходный товар</span><input placeholder="Артикул, SKU или ШК"><small>Физический товар</small></label><label><span>Товар после переклейки</span><input><small>Товар в заказе</small></label><label><span>Комментарий</span><input></label><button>Добавить товар</button></form>'));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.locator('.relabel-product-form').evaluate(el => getComputedStyle(el).display), 'grid');
      const boxes = await page.locator('.relabel-product-form label').first().evaluate(el => [...el.children].map(c => { const r = c.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, right: r.right }; }));
      assert.ok(boxes[1].top >= boxes[0].bottom && boxes[2].top >= boxes[1].bottom, `separate label/input/help at ${width}`);
      assert.ok(boxes.every(b => b.right <= width), `no overflowing controls at ${width}`);
    }
    await page.evaluate(() => document.documentElement.dataset.uiStyle = 'light');
    for (const selector of selectors.slice(0, 3)) {
      assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)', `Light ${selector}`);
    }
  } finally { await browser.close(); }
});

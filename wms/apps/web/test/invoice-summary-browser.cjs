// TEST: read-only localhost UI, no production authentication or API.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('http://127.0.0.1:5179/test/invoice-summary.html');
      await page.getByText('Услуги — суммарно').waitFor();
      assert.equal(await page.locator('tbody tr').count(), 2);
      const row = page.locator('tbody tr').filter({ hasText: 'Обработка товара' });
      assert.equal(await row.locator('td').nth(3).innerText(), '25');
      assert.equal(await row.locator('td').nth(5).innerText(), '250,00');
      const scroll = await page.locator('.billing-table-wrap').evaluate(el => {
        const needed = el.scrollWidth > el.clientWidth;
        el.scrollLeft = el.scrollWidth;
        return { needed, moved: el.scrollLeft > 0, overflow: getComputedStyle(el).overflowX };
      });
      if (scroll.needed) { assert(scroll.moved); assert(['auto', 'scroll'].includes(scroll.overflow)); }
      assert.equal(await page.locator('details').getAttribute('open'), null);
      await page.getByText('Показать детализацию услуг').click();
      assert(await page.getByText('Исходных строк: 3').isVisible());
      if (process.env.QA_OUTPUT) await page.screenshot({ path: `${process.env.QA_OUTPUT}/invoice-${width}.png`, fullPage: true });
      console.log(`PASS invoice ${width}px: 3 items -> 2 rows, sum 250, details accessible`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

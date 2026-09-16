// TEST: real layout and interactions against the local synthetic request-list fixture.
const { strict: assert } = require('node:assert');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [], failedResponses = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failedResponses.push(response.url()); });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    for (const role of ['admin', 'client']) {
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`http://127.0.0.1:5179/test/request-list.html?role=${role}`);
        await page.locator('.client-request-row').first().waitFor();
        const rows = page.locator('.client-request-row');
        assert.equal(await rows.count(), 5);
        for (const [index, number] of [999, 1000, 1001, 10000, 1000000].entries()) {
          const row = rows.nth(index);
          // TEST: persisted author is visible alongside the creation timestamp at every viewport.
          assert((await row.innerText()).includes(index === 0 ? 'Автор: не указан' : 'Автор: Тестовый автор заявки'));
          assert(!(await row.innerText()).includes('hidden@example.test'));
          const accent = row.locator('.client-request-number__accent');
          assert.equal(await accent.innerText(), String(number));
          const metrics = await accent.evaluate(element => {
            const range = document.createRange(); range.selectNodeContents(element);
            return { weight: Number(getComputedStyle(element).fontWeight), lines: range.getClientRects().length,
              fits: element.scrollWidth <= element.clientWidth + 1 };
          });
          assert(metrics.weight >= 700, `${number}: not bold`);
          assert.equal(metrics.lines, 1, `${number}: wraps at ${width}px (${role})`);
          assert(metrics.fits, `${number}: clipped at ${width}px (${role})`);
          const supply = row.locator('.client-request-wb-supplies');
          if (index === 0) { assert.equal(await supply.count(), 0); continue; }
          assert.equal(await supply.count(), 1);
          assert(await supply.evaluate(element => element.previousElementSibling.classList.contains('client-request-city')));
          const warehouseRect = await row.locator('.client-request-city').boundingBox();
          const supplyRect = await supply.boundingBox();
          assert(supplyRect.y >= warehouseRect.y + warehouseRect.height - 1, 'supply must be below warehouse');
          assert.equal(await supply.locator('strong').count(), index === 3 ? 2 : 1);
          assert.equal(await supply.evaluate(e => e.classList.contains('client-request-wb-supplies--pending')), index !== 2);
        }
        await page.getByRole('button', { name: 'Открыть заявку FBS тест 1000', exact: true }).click();
        assert.equal(await page.getByLabel('Открытая заявка').innerText(), '1000');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page overflow');
        if (process.env.QA_OUTPUT) {
          await page.screenshot({ path: `${process.env.QA_OUTPUT}/requests-${role}-${width}.png`, fullPage: true });
        }
        console.log(`PASS ${role} ${width}px: full bold numbers, supplies below warehouse, opening request`);
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(failedResponses, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

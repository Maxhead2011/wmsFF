const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// TEST: the real request and theme styles must keep Soul card cells readable at browser zoom widths.
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const viewportWidth of [1200, 900]) {
      const page = await browser.newPage({ viewport: { width: viewportWidth, height: 900 } });
      await page.setContent(`
        <div class="app-layout" data-ui-theme="modern"><div class="workspace-content"><div class="soul-page">
          <div class="client-request-table-wrap"><table class="client-request-table"><tbody>
            <tr class="client-request-row">
              <td class="client-request-table__request-cell" data-label="Заявка"><div class="client-request-identity"><div class="client-request-identity__main"><span>№01554</span><span>Поставка WB-GI-28548319</span></div><div class="client-request-identity__details">FBS — 5 заказов</div></div></td>
              <td class="client-request-table__client-cell">Клиент</td>
              <td class="client-request-table__composition-cell" data-label="Состав">CL-000001 ИП Лукин Илья Ильич · 5 позиций</td>
              <td class="client-request-table__due-cell" data-label="Срок"><div class="client-request-due-status">Новая</div></td>
              <td class="client-request-table__status-cell">Новая</td>
              <td class="client-request-table__warehouse-cell">Склад</td>
              <td class="client-request-table__actions-cell">Действия</td>
            </tr>
          </tbody></table></div>
        </div></div></div>`);
      const webSrc = path.resolve(__dirname, '../src');
      for (const relative of ['styles.css', 'components/client-requests/client-requests.css', 'components/layout/la-panthera-theme.css', 'components/layout/soul-theme.css']) {
        await page.addStyleTag({ content: fs.readFileSync(path.join(webSrc, relative), 'utf8') });
      }
      await page.evaluate(() => {
        document.documentElement.dataset.uiTheme = 'modern';
        document.documentElement.dataset.uiVariant = 'soul';
      });
      const widths = await page.evaluate(() => Object.fromEntries(['request', 'composition', 'due'].map((name) => [name, document.querySelector(`.client-request-table__${name}-cell`).getBoundingClientRect().width])));
      assert.ok(widths.request >= 180, `${viewportWidth}px: request cell collapsed to ${widths.request}px`);
      assert.ok(widths.composition >= 300, `${viewportWidth}px: composition cell collapsed to ${widths.composition}px`);
      assert.ok(widths.due >= 75, `${viewportWidth}px: due/status cell collapsed to ${widths.due}px`);
      await page.close();
    }
    // TEST: Soul uses the Panthera font and keeps readable counters on narrow cards.
    const page = await browser.newPage({ viewport: { width: 320, height: 700 } });
    await page.route('http://soul.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
    await page.route('http://soul.test/fonts/inter/InterVariable.woff2', (route) => route.fulfill({
      path: path.resolve(__dirname, '../public/fonts/inter/InterVariable.woff2'), contentType: 'font/woff2',
    }));
    await page.goto('http://soul.test/');
    await page.setContent(`<div class="app-layout" data-ui-theme="modern"><div class="workspace-content">
      <div class="soul-workspace"><section class="soul-group soul-client"><div class="soul-items">
        <button type="button"><span class="soul-number">01</span><span class="soul-item-label">Заявки на отгрузку</span><strong class="workspace-nav__badge">1260 (387)</strong><span class="soul-arrow">↗</span></button>
      </div></section></div>
      <div class="soul-page"><table><tbody><tr><td><span class="client-request-items-count">1260 единиц</span></td></tr></tbody></table></div>
    </div></div>`);
    for (const relative of ['styles.css', 'components/client-requests/client-requests.css', 'components/layout/la-panthera-theme.css', 'components/layout/soul-theme.css']) {
      await page.addStyleTag({ content: fs.readFileSync(path.resolve(__dirname, '../src', relative), 'utf8') });
    }
    await page.evaluate(() => Object.assign(document.documentElement.dataset, { uiTheme: 'modern', uiVariant: 'soul' }));
    const loadedFont = await page.evaluate(async () => {
      const faces = await document.fonts.load('700 14px "La Panthera Inter"', 'Заявки 1260');
      return faces.some((face) => face.status === 'loaded');
    });
    assert.ok(loadedFont, 'The bundled Inter font did not load');
    for (const mode of ['light', 'dark', 'winx']) {
      const result = await page.evaluate((mode) => {
        document.documentElement.dataset.soulMode = mode;
        const rgb = (color) => color.match(/\d+/g).map(Number).slice(0, 3);
        const luminance = (color) => rgb(color).map((value) => value / 255)
          .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const counters = ['.workspace-nav__badge', '.client-request-items-count'].map((selector) => {
          const element = document.querySelector(selector);
          const style = getComputedStyle(element);
          const [low, high] = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => a - b);
          return { font: style.fontFamily, size: parseFloat(style.fontSize), contrast: (high + 0.05) / (low + 0.05) };
        });
        const badge = document.querySelector('.workspace-nav__badge').getBoundingClientRect();
        const button = document.querySelector('.soul-items button');
        return { counters, font: getComputedStyle(button).fontFamily, fits: badge.right <= button.getBoundingClientRect().right };
      }, mode);
      assert.match(result.font, /La Panthera Inter/, mode);
      assert.ok(result.fits, `${mode}: counter overflows the navigation button`);
      for (const counter of result.counters) {
        assert.match(counter.font, /La Panthera Inter/, mode);
        assert.ok(counter.size >= 13, `${mode}: counter text is too small`);
        assert.ok(counter.contrast >= 4.5, `${mode}: counter contrast is ${counter.contrast}`);
      }
    }
    await page.close();
    console.log('PASS Soul request cards, Inter typography and counter contrast');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

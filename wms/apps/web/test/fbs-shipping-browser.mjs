import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';

// TEST: real FbsPanel, synthetic data, and intercepted API; never use a production login.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.env.FBS_SHIPPING_QA_OUTPUT || join(root, 'test-results/fbs-shipping');
await mkdir(out, { recursive: true });
const session = { accessToken: 'qa-only', tokenType: 'Bearer', user: { id: 'qa-user', email: 'qa@example.test', name: 'QA', roleCodes: ['ADMIN'], permissionCodes: [], activeWarehouseId: 'qa-warehouse', clientIds: ['qa-client'], writableClientIds: ['qa-client'], clientScopeMode: 'ALL' } };
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FbsShippingEditor } from '/src/components/fbs/FbsShippingEditor.tsx';
import '/src/styles.css';
createRoot(document.getElementById('root')).render(React.createElement(FbsShippingEditor, { accessToken:'qa-only', supplyId:'WB-GI-QA', cargoIds:['box1'], disabled:false, payload:{clientId:'qa-client',orders:[{connectionId:'qa-cabinet',id:'qa-order'}],plannedDeliveryDate:'2099-11-09'} }));
</script></body></html>`;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5197, strictPort: true }, plugins: [{ name: 'fbs-delivery-qa', configureServer(vite) {
  vite.middlewares.use('/__fbs_delivery_qa', async (_req, res, next) => {
    try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__fbs_delivery_qa', html)); } catch (error) { next(error); }
  });
} }] });
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], unexpected = [], submissions = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== '127.0.0.1') { unexpected.push(url.origin); return route.abort(); }
  if (!url.pathname.startsWith('/api/')) return route.continue();
  let response;
  const body = route.request().postDataJSON();
  submissions.push({path:url.pathname, body});
  if (url.pathname.endsWith('/shipping-points')) response={points:[{id:'42',name:'ПВЗ Москва',address:'Тестовая улица, 1',city:'Москва',officeType:'pp',available:true},{id:'43',name:'Перегружен',address:'Другой адрес',city:'Москва',officeType:'pp',available:false}]};
  else if (url.pathname.endsWith('/shipping-save')) response={saved:true};
  else if (url.pathname.endsWith('/shipping-cargo')) response={saved:true,cargoPlaceIds:['box1','box2']};
  else { unexpected.push(url.pathname); return route.abort(); }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
});
try {
  await page.goto('http://127.0.0.1:5197/__fbs_delivery_qa');
  await page.getByRole('button', {name:'Найти пункты сдачи'}).click();
  await page.getByLabel('ПВЗ / пункт приёма').waitFor();
  assert.equal(submissions[0].body.shippingPointId,undefined,'First search must omit an unselected point');
  assert.equal(await page.locator('option[value="43"]').evaluate(n=>n.disabled),true);
  await page.getByLabel('ПВЗ / пункт приёма').selectOption('42');
  await page.getByRole('button',{name:'Сохранить пункт и дату в WB'}).click();
  await page.getByText('Пункт сдачи и дата сохранены в WB.',{exact:true}).waitFor();
  await page.getByLabel('Итоговое количество грузомест').fill('2');
  await page.getByRole('button',{name:'Добавить недостающие грузоместа'}).click();
  await page.getByText(/Грузомест в WB: 2/).waitFor();
  assert.equal(submissions.length,3);
  assert.equal(submissions[1].body.shippingPointId,'42');
  assert.equal(submissions[2].body.cargoPlaceTotal,2);
  assert.equal(submissions.some(s=>s.path.endsWith('/deliver')),false);
  for (const width of [1440,768,375]) {
    await page.setViewportSize({width,height:1000});
    await page.screenshot({path:join(out,`shipping-${width}.png`)});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  console.log(JSON.stringify({result:'PASS',requests:submissions.length,viewports:[1440,768,375],stockWrites:0}));
} finally {await browser.close();await server.close();}

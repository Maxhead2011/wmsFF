const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const root = path.resolve(process.argv[2]);
const origin = process.env.TEST_ORIGIN;
const published = process.env.PUBLIC_MODE === 'true';
const user = {
  id: 'supply-release-check', name: 'Проверка выпуска', email: 'test@example.invalid',
  roleCodes: ['OWNER','ADMIN'], permissionCodes: ['system:admin'], clientScopeMode: 'ALL',
  clientIds: [], writableClientIds: [], activeWarehouseId: 'moscow', warehouseIds: ['moscow'],
  writableWarehouseIds: ['moscow'], administrationEnabled: true,
};
const live = JSON.parse(fs.readFileSync(path.join(root, 'live-verify.json'), 'utf8').replace(/^\uFEFF/, ''));
assert(live.request && live.membership.length===1 && live.shipping[0].points.length);
const request=live.request, client={...request.client, marketplaceConnections:[{marketplace:'WILDBERRIES',isActive:true}]};
const orders=live.orders.map(order=>({...order,request,category:'active',requiredMeta:order.requiredMeta??[],optionalMeta:order.optionalMeta??[],barcodes:order.barcodes??[],storageBoxes:order.storageBoxes??[]}));
const delivery=live.delivery;
const snapshot={client,connected:true,connections:[{id:orders[0].connectionId,marketplace:'WILDBERRIES',accountName:'WB'}],
  deliveryPlan:{destination:'PICKUP_POINT',itemsPerCargoPlace:1,requiresCargoPlaces:true},orders,
  counts:{all:orders.length,active:orders.length,shipped:0,archive:0,cancelled:0},fetchedAt:new Date().toISOString()};
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
    page.setDefaultTimeout(14000);
    const errors = [], calls = [];
    page.on('pageerror', e => { errors.push(e.message); console.error(e.stack); });
    await page.addInitScript(u => {
      localStorage.setItem('logoff-wms-session', JSON.stringify({ accessToken: 'synthetic', user: u }));
      localStorage.setItem('logoff-wms-ui-theme:' + u.id, 'modern');
    }, user);
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      if (p.startsWith('/api/')) {
        let body = []; if(process.env.DEBUG_BROWSER)console.log(req.method(),p,url.search);
        if (p.endsWith('/auth/me')) body = user;
        else if (p.endsWith('/branches')) body = [{ id: 'moscow', name: 'ФФ Москва', isActive: true }];
        else if (p.endsWith('/clients')) body = [client];
        else if (p.endsWith('/box-overlaps')) body = { statusCounts: [], overlaps: [], errors: [], overlappingBoxesCount: 0 };
        else if (p.endsWith('/client-requests')) body = [request];
        else if (p.endsWith('/fbs/orders')) body = snapshot;
        else if (p.endsWith('/fbs/active-clients')) body = [{ client, activeOrders: 2 }];
        else if (p.endsWith('/delivery-options') || p.endsWith('/all-labels') || p.endsWith('/shipping-points')) {
          calls.push({ path: p, payload: req.postDataJSON() });
          body = p.endsWith('/delivery-options') ? delivery : p.endsWith('/shipping-points') ? live.shipping[0] : live.pdf;
        } else if (req.method() !== 'GET') {
          throw Error('Unexpected request: '+req.method()+' '+p);
        }
        return route.fulfill({ json: body });
      }
      if (!published && url.origin === origin) {
        const file = path.join(root, 'stay-payload', p === '/' ? 'index.html' : p);
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
          return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html' });
        }
      }
      return route.continue();
    });
    const openRequests = async () => {
      await page.getByText('Заявки', { exact: true }).first().click();
      await page.locator('tr').filter({ hasText: request.title }).waitFor().catch(async e=>{console.log((await page.locator('body').innerText()).slice(-4500));throw e;});
      return page.locator('tr').filter({ hasText: request.title });
    };
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByText('Быстрый доступ', { exact: true }).waitFor();
    let row = await openRequests();
    await row.getByRole('button', { name: 'Передать на МП' }).click();
    const dialog = page.getByRole('dialog', { name: 'Пункт сдачи и грузоместа WB' });
    await dialog.waitFor(); assert(await row.isVisible(), 'Requests must remain visible behind dialog'); assert.equal(await page.locator('.workspace-content--fbs').count(),0);
    assert.equal(await dialog.locator('input[type="date"]').first().inputValue(), delivery.defaultPlannedDeliveryDate);
    await dialog.getByText(/Грузомест в WB: 1/).waitFor();
    await dialog.getByRole('button', { name: 'Найти пункты сдачи' }).click();
    const select = dialog.getByLabel('ПВЗ / пункт приёма');
    await select.waitFor();
    const available = await select.locator('option:not([disabled])').count();
    assert(available > 1);
    await select.selectOption(await select.locator('option:not([disabled])').nth(1).getAttribute('value'));
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    assert(await row.isVisible(), 'Requests must remain visible after cancel');
    await row.getByText('Стикеры поставки', { exact:true }).click();
    const download=page.waitForEvent('download');
    await row.getByRole('button', { name:'Скачать все ШК',exact:true }).click();
    const pdf=await download; assert(await row.isVisible()); assert.equal(await page.locator('.workspace-content--fbs').count(),0);
    assert.equal(pdf.suggestedFilename(),live.pdf.fileName);
    assert.deepEqual(fs.readFileSync(await pdf.path()),Buffer.from(live.pdf.fileBase64,'base64'));
    assert.equal(calls.length,3);
    for(const {payload} of calls){
      assert.equal(payload.clientId,live.payload.clientId);
      assert.deepEqual(payload.orders.map(o=>o.connectionId+':'+o.id).sort(),live.payload.orders.map(o=>o.connectionId+':'+o.id).sort());
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({request:request.number,date:delivery.defaultPlannedDeliveryDate,availableOptionsShown:available-1,cargoPlaces:1,pdfPages:live.pages,exactPdf:true}));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});


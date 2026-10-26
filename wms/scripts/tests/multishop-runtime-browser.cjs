// TEST: built web application, isolated educational API; never sends marketplace mutations.
// Run after web build: node scripts/tests/fbs-stock-selection-browser.cjs <output-directory>
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dist = path.resolve(process.env.WEB_DIST || path.resolve(__dirname, '../../apps/web/dist'));
const overlay = process.env.WEB_OVERLAY && path.resolve(process.env.WEB_OVERLAY);
const out = path.resolve(process.argv[2]); fs.mkdirSync(out, { recursive: true });
const user = { id: 'test-client', email: 'client@example.test', name: 'Учебный клиент', roleCodes: ['CLIENT'], permissionCodes: ['stock:read', 'client-requests:read', 'client-requests:write', 'billing:read', 'catalog:read', 'receipts:read'], clientScopeMode: 'LIMITED', clientIds: ['demo'], writableClientIds: ['demo'], warehouseIds: [], writableWarehouseIds: [] };
let multishopSaved={revision:null,config:{groups:[],assignments:[]}};let multishopWrites=0;
const client = { id: 'demo', code: 'CL-DEMO', fbsCalculatorEnabled: true, name: 'Учебный клиент', legalName: 'Учебный клиент', status: 'ACTIVE' };
const connections = [{ id: 'shop', marketplace: 'WILDBERRIES', accountName: 'Магазин один' }, { id: 'shop-2', marketplace: 'WILDBERRIES', accountName: 'Магазин два' }];
const items = Array.from({ length: 400 }, (_, i) => ({
  skuId: 'sku-' + i, name: i < 10 ? 'Костюм размер ' + i : 'Другой товар ' + i,
  internalSku: 'SKU-' + i, article: i < 10 ? 'MATCH' : 'OTHER-' + i, size: String(i), barcode: '2000000' + i,
  nmId: String(i), chrtId: String(i), status: 'SELLING', enabled: true, wmsAvailable: 10, reserved: 0,
  safetyReserve: 0, sellable: 10, wbAmount: 10, publishedAmount: 10, saleLimit: null, relabelManualAmount: null,
  relabeling: { isSource: false, isTarget: false, sources: [], allocatedFromSources: 0, allocatedToTargets: 0, capacity: 0 },
  requestedAmount: 10, targetAmount: 10, shortage: false, shortageAmount: 0, difference: 0,
}));
const historyOrders=['shipped','archive','cancelled'].map((category,i)=>({id:'900000'+i,connectionId:'shop',marketplace:'WILDBERRIES',category,supplierStatus:category==='cancelled'?'cancel':'complete',wbStatus:category==='archive'?'sold':category==='cancelled'?'canceled':'sorted',statusLabel:category==='archive'?'Получен покупателем':category==='cancelled'?'Отменён':'В доставке',accountName:'Магазин один',article:'HISTORY-'+i,nmId:'123',chrtId:'456',barcodes:['200000000001'],itemCount:1,product:null,storageBoxes:[],createdAt:'2026-10-20T10:00:00Z',sellerDate:'2026-10-21T10:00:00Z',deliveryDate:null,supplyId:null,warehouseId:'wh',warehouseName:'Москва',officeId:null,requiredMeta:[],optionalMeta:[],request:null,billing:null,shipmentPlan:null}));
const stocks = () => ({ client, connected: true, connections, selectedConnectionId: 'shop',
  warehouses: [{ id: 'warehouse', name: 'Учебный склад WB' }], selectedWarehouseId: 'warehouse', connectedWarehouseId: 'warehouse',
  summary: { products: 400, enabled: 400, disabled: 0, unmanaged: 0, wmsAvailable: 4000, sellable: 4000, wbAmount: 4000, differences: 0, excessProducts: 0, excessUnits: 0, shortages: 0 }, items });
const mutations = [], errors = [], allocationReads = [];
const allocation = { policy: {enabled:true,lowStockThreshold:10,recommendationDays:30}, shares:[{warehouseId:'wh',warehouseName:'Москва',isPrimary:true,percent:100,recommendedPercent:100}], recommendation:{periodDays:30,basedOnOrders:15}, integrationKeys:[],changes:[],unacknowledgedChanges:0 };
const server = http.createServer((req, res) => {
  let file = path.resolve(dist, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(dist + path.sep)) file = path.join(dist, 'index.html');
  if (overlay) {
    const candidate = path.join(overlay, path.relative(dist, file));
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) file = candidate;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(overlay || dist, 'index.html');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.WEB_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
      const p = url.pathname.replace(/^\/api(?:\/v1)?/, ''); let data = [];
      if (p === '/auth/me') data = user;
      else if(p === '/marketplace-connections/fbs/penalties-report') data={client,period:{dateFrom:'2026-10-01',dateTo:'2026-10-24'},selectedConnectionId:null,search:'',summary:{penalties:0,chargedPenalty:0,reversedPenalty:0,netPenalty:0,orders:0,reasons:0,accounts:0,currency:'RUB'},reasons:[],rows:[],sources:[],truncated:false,generatedAt:'2026-10-24T09:00:00Z'};
      else if(p==='/marketplace-connections/multishop/capabilities') data={enabled:true,publicationEnabled:false};
      else if(p==='/marketplace-connections/multishop/demo/products') data={items:[{id:'sku-group',name:'Тестовый костюм',article:'A',size:'52',color:'Синий',barcodes:[{value:'001'}]}],page:1,pageSize:50,total:1};
      else if(p==='/marketplace-connections/multishop/demo') {
        if(request.method()==='PUT'){const body=request.postDataJSON();assert.equal(body.revision,multishopSaved.revision);multishopSaved={revision:'v1',config:body.config};multishopWrites++;}
        data={...multishopSaved,invalidReason:null,connections:[{id:'wb',accountName:'WB первый',marketplace:'WILDBERRIES',fbsExecutionWarehouseId:'msk'},{id:'ozon',accountName:'Ozon первый',marketplace:'OZON',fbsExecutionWarehouseId:'msk'}]};
      }
      else if (p === '/clients') data = [client];
      else if (p === '/marketplace-connections/fbs/active-clients') data = [{ client, activeOrders: 0 }];
      else if (p === '/marketplace-connections/fbs/orders') data = { client, connected: true, connections, deliveryPlan:{requiresCargoPlaces:false},fetchedAt:'2026-10-24T09:00:00Z',counts: { active: 0, shipped: 1, cancelled: 1, archive: 1, all: 3 }, orders: historyOrders };
      else if (p === '/marketplace-connections/allocation/capabilities' || p === '/marketplace-connections/duplicate-groups/capabilities' || p === '/marketplace-connections/stock-confirmation/capabilities') data={enabled:true};
      else if (p === '/marketplace-connections/allocation/demo') data={connections,message:'Учебные кабинеты WB и Ozon'};
      else if (p === '/marketplace-connections/fbs/stocks') data = {...stocks(),selectedConnectionId:url.searchParams.get('connectionId')||'shop'};
      else if (p === '/marketplace-connections/fbs/calculator/destinations') data={destinations:['Москва']};
      else if (p === '/marketplace-connections/fbs/reshipment/capabilities') data={enabled:true};
      else if (p === '/marketplace-connections/fbs/stocks/allocation') {
        if(request.method()==='GET') allocationReads.push(url.searchParams.get('connectionId')); else mutations.push(request.postDataJSON());
        data=allocation;
      }
      else if (p.includes('/stocks/publication')) {
        const body = request.postDataJSON(); mutations.push(body);
        data = { updatedProducts: body.skuIds.length, amount: 0 };
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await context.addInitScript(u => {
      localStorage.setItem('logoff-wms-session', JSON.stringify({ accessToken: 'isolated-test', tokenType: 'Bearer', user: u }));
      localStorage.setItem('logoff-wms-ui-theme:' + u.id, 'modern');
    }, user);
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin);
    await page.locator('aside').getByRole('button', { name: 'FBS', exact: true }).click();
    await page.getByRole('button', { name: /FBS WB/ }).click();
    const tileNames=await page.locator('.fbs-tiles [role=tab]').allTextContents();
    assert.equal(tileNames.length,7);assert(!tileNames.some(n=>n.includes('Короба WMS')));
    assert(tileNames.some(n=>n.includes('Проблемные заявки')));assert(tileNames.some(n=>n.includes('Архив заявок')));assert(tileNames.some(n=>n.includes('Настройки стоимости')));
    await page.locator('.fbs-tiles').screenshot({path:path.join(out,'menu.png')});
    await page.getByRole('tab', { name: /Управление автоматическим распределением остатков/ }).click();
    const hub=page.getByRole('navigation',{name:'Разделы управления остатками'});await hub.waitFor();
    assert.equal(await hub.locator('button').count(),5);
    for(const name of ['Между магазинами','Между артикулами','Подтверждение остатков WB'])assert.equal(await hub.getByRole('button',{name:new RegExp(name)}).isEnabled(),true);
    await hub.getByRole('button',{name:/Между магазинами/}).click();
    await page.getByRole('button',{name:'Добавить группу',exact:true}).click();
    await page.getByLabel('Название группы').fill('Первая пара');
    await page.getByLabel('WB · WB первый',{exact:true}).check();await page.getByLabel('Ozon · Ozon первый',{exact:true}).check();
    await page.getByLabel('Доля, %',{exact:true}).nth(0).fill('50');await page.getByLabel('Доля, %',{exact:true}).nth(1).fill('50');
    await page.getByLabel('Выбрать Тестовый костюм',{exact:true}).check();await page.getByLabel('Группа для выбранных товаров').selectOption({label:'Первая пара'});
    await page.getByRole('button',{name:'Назначить выбранным (1)',exact:true}).click();await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Группы и назначения сохранены'}).waitFor();
    assert.equal(multishopWrites,1);assert.equal(multishopSaved.config.assignments[0].skuId,'sku-group');
    await page.locator('.multishop-groups').screenshot({path:path.join(out,'groups-desktop.png')});
    await page.getByText('Прежняя настройка одной пары WB/Ozon',{exact:true}).click();
    await page.getByRole('button',{name:'Все разделы',exact:true}).click();await hub.waitFor();
    await hub.getByRole('button',{name:/Резервы и предпросмотр/}).click();
    const section = page.locator('.fbs-stocks'); await section.waitFor();
    await section.locator('.fbs-stocks__selectors select').first().selectOption('shop-2');
    await page.waitForFunction(()=>document.querySelector('.fbs-stocks__selectors select').value==='shop-2');
    await page.getByRole('button',{name:'Все разделы',exact:true}).click();await hub.waitFor();
    await hub.getByRole('button',{name:/Между складами/}).click();
    await page.getByRole('button',{name:'Сохранить распределение',exact:true}).waitFor();
    await page.getByRole('button',{name:'Все разделы',exact:true}).click();
    await page.getByRole('tab',{name:/Архив заявок/}).click();
    const completed=page.getByRole('region',{name:'Получены покупателями'});await completed.waitFor();
    for(let i=0;i<4;i++){const expand=completed.getByRole('button',{name:'Развернуть группу заказов',exact:true});if(!await expand.count())break;await expand.first().click();}
    assert.match(await completed.textContent(),/9000001/);assert.equal(await completed.locator('input[type=checkbox]').count(),0);
    const history=page.getByRole('navigation',{name:'Архив заявок'});await history.getByRole('button',{name:'Отменённые заказы',exact:true}).click();
    assert.equal(await page.getByRole('tab',{name:/Архив заявок/}).getAttribute('aria-selected'),'true');
    await page.locator('.fbs-cancelled-export').waitFor();
    await page.getByRole('tab',{name:/Проблемные заявки/}).click();
    await page.getByRole('navigation',{name:'Проблемные заявки'}).getByRole('button',{name:'Повторный довоз',exact:true}).click();
    await page.getByRole('button',{name:'Проверить WB',exact:true}).waitFor();
    assert.equal(await page.getByRole('tab',{name:/Проблемные заявки/}).getAttribute('aria-selected'),'true');
    const problems=page.getByRole('navigation',{name:'Проблемные заявки'});
    // TEST: existing penalties report opens inside problem orders, without a separate tile.
    await problems.getByRole('button',{name:'Штрафы по FBS',exact:true}).click();await page.locator('.fbs-penalties-report').waitFor();
    assert.equal(await page.getByRole('tab',{name:/Проблемные заявки/}).getAttribute('aria-selected'),'true');
    assert.equal(await problems.getByRole('button',{name:'Штрафы по FBS',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('tab',{name:/Настройки стоимости/}).click();
    const cost=page.getByRole('navigation',{name:'Настройки стоимости'});assert.equal(await cost.getByRole('button',{name:'Назначение стоимости обработки',exact:true}).count(),0);
    await cost.getByRole('button',{name:'Калькулятор стоимости',exact:true}).click();await page.locator('.fbs-calculator').waitFor();
    for(const width of [1440,768,390]) { await page.setViewportSize({width,height:1000});await page.locator('.fbs-tiles').screenshot({path:path.join(out,`menu-${width}.png`)}); }
    await page.setViewportSize({width:1440,height:1000});
    for(const style of ['light','dark']){await page.evaluate(style=>{document.documentElement.dataset.uiVariant='la_panthera';document.documentElement.dataset.uiTheme='modern';document.documentElement.dataset.uiStyle=style;},style);await page.locator('.fbs-tiles').screenshot({path:path.join(out,`menu-panthera-${style}.png`)});
      // TEST: measured geometry, not CSS strings: 1 spans both rows, 2-4 above 5-7.
      const boxes=await page.locator('.fbs-tiles > .fbs-tile').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};}));
      assert.equal(boxes.length,7);const near=(a,b)=>assert(Math.abs(a-b)<3,`${a} != ${b}`);
      near(boxes[0].y,boxes[1].y);near(boxes[1].y,boxes[2].y);near(boxes[2].y,boxes[3].y);
      near(boxes[4].y,boxes[5].y);near(boxes[5].y,boxes[6].y);near(boxes[0].bottom,boxes[6].bottom);
      for(let i=1;i<=3;i++)near(boxes[i].x,boxes[i+3].x);
      assert(boxes[4].y>boxes[1].bottom);assert(boxes[0].height>boxes[1].height*1.8);assert(boxes[0].width>boxes[1].width);
}
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify({builtWeb:true,isolatedApi:true,multishopWrites,passed:['group editor in runtime hub','canonical assignment persisted','legacy pair retained','7 tiles','all 5 existing allocation sections','existing stocks/cabinet selector','existing warehouse settings','history tabs + received order read-only','problem tabs','restricted tariffs','calculator','3 widths','Panthera light/dark','penalties within problems','two-row desktop geometry'],mutations:mutations.length},null,2));
    console.log('PASS actual runtime:7 tiles, retained5-section hub, stocks/cabinet/warehouse settings, history/problems/cost,3 widths');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });

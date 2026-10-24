// TEST: built web application, isolated educational API; never sends marketplace mutations.
// Run after web build: node scripts/tests/fbs-stock-selection-browser.cjs <output-directory>
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dist = path.resolve(process.env.WEB_DIST || path.resolve(__dirname, '../../apps/web/dist'));
const overlay = process.env.WEB_OVERLAY && path.resolve(process.env.WEB_OVERLAY);
const out = path.resolve(process.argv[2]); fs.mkdirSync(out, { recursive: true });
const user = { id: 'test-client', email: 'client@example.test', name: 'Учебный клиент', roleCodes: ['CLIENT'], permissionCodes: ['stock:read', 'client-requests:read', 'client-requests:write', 'billing:read', 'catalog:read', 'receipts:read'], clientScopeMode: 'LIMITED', clientIds: ['demo'], writableClientIds: ['demo'], warehouseIds: [], writableWarehouseIds: [] };
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
      else if (p === '/clients') data = [client];
      else if (p === '/marketplace-connections/fbs/active-clients') data = [{ client, activeOrders: 0 }];
      else if (p === '/marketplace-connections/fbs/orders') data = { client, connected: true, connections, deliveryPlan:{requiresCargoPlaces:false},fetchedAt:'2026-10-24T09:00:00Z',counts: { active: 0, shipped: 1, cancelled: 1, archive: 1, all: 3 }, orders: historyOrders };
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
    assert.equal(tileNames.length,8);assert(!tileNames.some(n=>n.includes('Короба WMS')));
    assert(tileNames.some(n=>n.includes('Проблемные заявки')));assert(tileNames.some(n=>n.includes('Архив заявок')));assert(tileNames.some(n=>n.includes('Настройки стоимости')));
    await page.locator('.fbs-tiles').screenshot({path:path.join(out,'menu.png')});
    await page.getByRole('tab', { name: /Управление автоматическим распределением остатков/ }).click();
    const section = page.locator('.fbs-stocks'); await section.waitFor();
    assert.deepEqual(allocationReads,[]);
    const rules=section.locator('.fbs-stock-management');await rules.locator('summary').click();
    await rules.getByRole('button',{name:'Сохранить распределение',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.fbs-allocation__total')?.textContent.includes('100%'));
    assert.deepEqual(allocationReads,['shop']);
    const threshold=rules.locator('.fbs-allocation__rules input');await threshold.fill('12');
    await rules.locator('summary').click();await rules.locator('summary').click();assert.equal(await threshold.inputValue(),'12');assert.deepEqual(allocationReads,['shop']);
    await section.locator('.fbs-stocks__selectors select').first().selectOption('shop-2');
    await page.waitForFunction(()=>document.querySelector('.fbs-stocks__selectors select').value==='shop-2');
    await rules.locator('summary').click();await page.waitForFunction(()=>document.querySelector('.fbs-allocation__total')?.textContent.includes('100%'));
    assert.equal(allocationReads.at(-1),'shop-2');assert.equal(await threshold.inputValue(),'10');
    await rules.getByRole('button',{name:'Сохранить распределение',exact:true}).click();
    await rules.getByText('Настройки сохранены.',{exact:false}).waitFor();assert.equal(mutations.at(-1).connectionId,'shop-2');assert.equal(mutations.at(-1).clientId,'demo');
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
    await page.getByRole('tab',{name:/Настройки стоимости/}).click();
    const cost=page.getByRole('navigation',{name:'Настройки стоимости'});assert.equal(await cost.getByRole('button',{name:'Назначение стоимости обработки',exact:true}).count(),0);
    await cost.getByRole('button',{name:'Калькулятор стоимости',exact:true}).click();await page.locator('.fbs-calculator').waitFor();
    for(const width of [1440,768,390]) { await page.setViewportSize({width,height:1000});await page.locator('.fbs-tiles').screenshot({path:path.join(out,`menu-${width}.png`)}); }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify({builtWeb:true,isolatedApi:true,passed:['8 tiles','lazy allocation','collapse retains draft','selected cabinet isolation','exact save payload','history tabs + received order read-only','problem tabs','restricted tariffs','calculator','3 widths'],mutations:mutations.length},null,2));
    console.log('PASS grouped menu, cabinet-specific rules, lazy loading, preserved draft, history/problems/cost controls and three widths');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });

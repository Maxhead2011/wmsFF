// TEST: built web application, isolated educational API; never sends marketplace mutations.
// Run after web build: node scripts/tests/fbs-stock-selection-browser.cjs <output-directory>
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dist = path.resolve(process.env.WEB_DIST || path.resolve(__dirname, '../../apps/web/dist'));
const overlay = process.env.WEB_OVERLAY && path.resolve(process.env.WEB_OVERLAY);
const out = path.resolve(process.argv[2]); fs.mkdirSync(out, { recursive: true });
const user={id:'test-admin',name:'Test administrator',roleCodes:['ADMIN'],permissionCodes:['skus:read','skus:write','clients:read','clients:write','marketplace-api:read','marketplace-api:write'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],warehouseIds:[],writableWarehouseIds:[]};
const client={id:'demo',code:'CL-DEMO',name:'Test client',status:'ACTIVE'};
const connections=[{id:'wb',clientId:'demo',marketplace:'WILDBERRIES',accountName:'WB account',isActive:true},{id:'oz',clientId:'demo',marketplace:'OZON',accountName:'Ozon account',isActive:true}];
const sku={photoUrls:[],marketplacePhotos:[],needsChestnyZnak:false,isUnmarked:true,volumeLiters:1,id:'s',name:'Test product',internalSku:'TEST',client,marketplace:'WILDBERRIES',marketplaceOfferId:'WB-1',barcodes:[{value:'001'}]};
let enabled=false,fail=false;
const links=id=>({enabled,items:enabled?[{id,marketplace:id==='wb'?'WILDBERRIES':'OZON',skuId:'s',sku,productId:id+'-id',offerId:id+'-offer',barcodes:[id==='wb'?'001':'002'],status:'LINKED',available:2,reserved:0}]:[]});
const mutations = [], errors = [];
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
      else if(p==='/marketplace-connections')data=connections;
      else if(p==='/skus')data=[sku];
      else if(p==='/skus/bulk-volume')data={items:[],total:0,matchedCount:0};
      else if(p.endsWith('/catalog-reconciliation/enable')){mutations.push(p);enabled=true;data={enabled:true,changed:true};}
      else if(p.endsWith('/product-links')){if(fail){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Test failure'})});return;} data=links(p.split('/')[2]);}
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await context.addInitScript(u => {
      localStorage.setItem('logoff-wms-session', JSON.stringify({ accessToken: 'isolated-test', tokenType: 'Bearer', user: u }));
      localStorage.setItem('logoff-wms-ui-theme:' + u.id, 'modern');
    }, user);
    const page = await context.newPage(); page.on('pageerror', e => {errors.push(e.stack);console.error(e.stack)});
    await page.goto(origin);
    await page.locator('aside').getByRole('button',{name:'Каталог',exact:true}).click();
    await page.getByRole('button',{name:/Поиск и карточки/}).click();
    fs.writeFileSync(path.join(out,'debug.html'),await page.content());
    await page.locator('.catalog-panel select').first().selectOption('demo');
    await page.getByRole('button',{name:'Включить сверку WB/Ozon',exact:true}).waitFor();
    assert.equal(mutations.length,0);
    await page.getByRole('button',{name:'Включить сверку WB/Ozon',exact:true}).click();
    await page.getByRole('button',{name:'Проверить соответствия WB и Ozon',exact:true}).waitFor();
    await page.locator('.catalog-table').getByText('ШК: 002',{exact:true}).waitFor();
    assert.equal(mutations.length,1);assert(mutations[0].includes('/wb/'));
    assert.match(await page.locator('.catalog-table').innerText(),/WB account/);
    assert.match(await page.locator('.catalog-table').innerText(),/Ozon account/);
    await page.getByRole('button',{name:'Проверить соответствия WB и Ozon',exact:true}).click();
    await page.getByText('Проверено карточек: 2. Требуют внимания: 1.',{exact:true}).waitFor();
    await page.screenshot({path:path.join(out,'catalog.png'),fullPage:true});
    fail=true;await page.getByRole('button',{name:'Проверить соответствия WB и Ozon',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Test failure'}).waitFor();
    assert.equal(await page.getByText('Проверено карточек: 2. Требуют внимания: 1.',{exact:true}).count(),0);
    assert.equal(mutations.length,1);assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify({passed:6,isolatedApi:true,mutations:1,errors}));
    console.log('6 catalog browser checks passed');
  } finally { fs.writeFileSync(path.join(out,'errors.json'),JSON.stringify(errors)); await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });

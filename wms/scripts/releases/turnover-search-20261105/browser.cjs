// TEST: count real root bootstraps across initial load, reload and lazy navigation.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(process.argv[2]);
const server=http.createServer((req,res)=>{const rel=new URL(req.url,'http://local').pathname.slice(1)||'index.html';if(rel.includes('..'))return res.end();let p=path.join(root,'web-payload',rel);if(!fs.existsSync(p))p=path.join(root,'web-base',rel);if(!fs.existsSync(p)){res.writeHead(404);return res.end()}let data=fs.readFileSync(p);if(rel.endsWith('.js')){let s=data.toString();s=s.replace(/(\w+)\.createRoot\(document\.getElementById\("root"\)\)/g,(m)=>`((window.__wmsBoots??=[]).push(${JSON.stringify(rel)}),${m})`);data=Buffer.from(s)}res.setHeader('Content-Type',rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':'application/octet-stream');res.end(data)});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage(),errors=[],warnings=[],queries=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/createRoot|Invalid hook|Minified React|already been passed/.test(m.text()))warnings.push(m.text())});
 const user={id:'fixture',name:'Synthetic',administrationEnabled:true,roleCodes:['OWNER','ADMIN'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:'w',warehouseIds:['w'],writableWarehouseIds:['w']};
 await page.addInitScript(u=>localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'fixture-only',tokenType:'Bearer',user:u})),user);
 await page.route('**/api/v1/**',async route=>{const p=new URL(route.request().url()).pathname;let data=[];if(p.endsWith('/clients'))data=[{id:'fixture-client',name:'Fixture client'}];else if(p.endsWith('/turnover/suggestions'))data={products:[{skuId:'fixture-sku',name:'Костюм реглан',article:'Костюм_реглан_синий',size:'S / 44',barcode:'2047945569214',client:{id:'fixture-client',name:'Fixture client'}}],barcodes:[],kiz:[],boxes:[]};else if(p.endsWith('/turnover')){queries.push(new URL(route.request().url()).searchParams);data={items:[],totals:{skuCount:0,currentQuantity:0,receivedQuantity:0,shippedQuantity:0,writtenOffQuantity:0}};}else if(p.endsWith('/turnover/statistics'))data={rows:[],totals:{}};else if(p.endsWith('/auth/me'))data=user;else if(p.endsWith('/users/workspaces'))data={users:[],workspaces:[]};else if(p.endsWith('/box-overlaps'))data={errors:[],overlaps:[],requestsWithOverlapsCount:0,overlappingBoxesCount:0};else if(p.endsWith('/branches'))data=[{id:'w',code:'MSK',name:'Москва',warehouseId:'w',isActive:true}];await route.fulfill({json:data})});
 // TEST: public mode fetches the deployed scripts and only adds a bootstrap counter.
 if(process.env.PUBLIC_URL)await page.route('**/*.js',async route=>{const response=await route.fetch();let body=await response.text();const rel=new URL(route.request().url()).pathname;body=body.replace(/(\w+)\.createRoot\(document\.getElementById\("root"\)\)/g,m=>`((window.__wmsBoots??=[]).push(${JSON.stringify(rel)}),${m})`);await route.fulfill({response,body})});
 await page.goto(process.env.PUBLIC_URL||'http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
 const checks=[];async function verify(label){const boots=await page.evaluate(()=>window.__wmsBoots??[]);checks.push({label,boots});assert.equal(boots.length,1,JSON.stringify(checks));assert((await page.locator('#root').innerText()).trim().length>20,'blank screen');assert.deepEqual(errors,[]);assert.deepEqual(warnings,[])}
 await verify('initial');await page.reload({waitUntil:'networkidle'});await verify('reload');
 await page.locator('details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
 await page.getByRole('button',{name:/^Товарооборот/}).first().click();
 await page.getByRole('button',{name:/Товаро-движение/}).click();
 await page.locator('.turnover-workspace select').first().selectOption('fixture-client');
 await page.getByLabel('Поиск по товару',{exact:true}).fill('Костюм');
 await page.getByRole('button',{name:/Костюм_реглан_синий/}).first().click();
 await page.getByRole('button',{name:'Показать',exact:true}).click();
 await page.waitForTimeout(500);
 assert.equal(queries.at(-1).get('skuId'),'fixture-sku');assert.equal(queries.at(-1).get('search'),null);assert.equal(queries.at(-1).get('barcode'),'2047945569214');
 await page.getByLabel('Поиск по товару',{exact:true}).fill('Другой костюм');
 await page.getByRole('button',{name:'Показать',exact:true}).click();await page.waitForTimeout(500);
 assert.equal(queries.at(-1).get('skuId'),null);assert.equal(queries.at(-1).get('search'),'Другой костюм');
 await verify('selected SKU and edited search');
 await page.unrouteAll({behavior:'wait'});assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);
 fs.writeFileSync(root+(process.env.PUBLIC_URL?'/public-turnover-browser-proof.json':'/turnover-browser-proof.json'),JSON.stringify({passed:checks.length,checks,errors,warnings},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
}finally{await browser.close();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);server.close();process.exitCode=1});

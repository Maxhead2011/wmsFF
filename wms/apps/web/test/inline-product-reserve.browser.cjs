// TEST: use the actual React editor and API client with synthetic HTTP responses; no real business writes.
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('node:assert/strict'),{createRequire}=require('module');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const root=path.resolve('wms/apps/web'),r=createRequire(require.resolve('vite',{paths:[root+'/node_modules']})),esbuild=r('esbuild');
(async()=>{
 const built=await esbuild.build({entryPoints:[root+'/test/inline-product-reserve.fixture.tsx'],bundle:true,write:false,format:'esm',define:{'import.meta.env.VITE_API_URL':'"/api/v1"'}});
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');if(req.url==='/fbs.css'){res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(root+'/src/components/fbs/fbs.css'));return;}res.end(req.url==='/fixture.js'?built.outputFiles[0].text:'<meta charset="utf-8"><link rel="stylesheet" href="/fbs.css"><div id="root"></div><div id="saved">0</div><script type="module" src="/fixture.js"></script>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage();const writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));let override=null,conflict=false;
 await page.route('**/api/v1/**',async route=>{const req=route.request();if(req.method()==='GET'){await route.fulfill({json:{reserve:{mode:'UNITS',value:3},analysis:null,reserveRows:['sku-one','sku-two'].map(skuId=>({skuId,blocked:skuId==='sku-one',reserveOverride:skuId==='sku-one'?override:null,ruleUpdatedAt:override?'v2':null}))}});return;}
 writes.push({url:req.url(),body:req.postDataJSON()});if(conflict){await route.fulfill({status:409,json:{message:'Резерв уже изменён. Обновите список.'}});return;}override=req.postDataJSON().reserve;await route.fulfill({json:{ok:true}});});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const rows=page.locator('tr');assert.equal(await rows.count(),2);
 await rows.nth(0).locator('summary').click();await rows.nth(0).getByLabel('Резерв товара',{exact:true}).selectOption('NONE');
 await rows.nth(0).getByRole('button',{name:'Сохранить резерв товара',exact:true}).click();await page.getByText('Резерв сохранён.',{exact:false}).waitFor();
 assert.equal(writes.length,1);assert(writes[0].url.endsWith('/client/skus/sku-one'));assert.deepEqual(writes[0].body,{reserve:{mode:'NONE',value:0},blocked:true,expectedUpdatedAt:null});assert.equal(await page.locator('#saved').textContent(),'1');assert.equal(await rows.nth(0).getByLabel('Резерв товара',{exact:true}).inputValue(),'NONE');
 conflict=true;await rows.nth(1).locator('summary').click();await rows.nth(1).getByLabel('Резерв товара',{exact:true}).selectOption('UNITS');await rows.nth(1).getByLabel('Величина резерва').fill('2');await rows.nth(1).getByRole('button',{name:'Сохранить резерв товара',exact:true}).click();await page.getByRole('alert').filter({hasText:'Резерв уже изменён'}).waitFor();
 assert.equal(await page.locator('#saved').textContent(),'1');assert.equal(writes.length,2);assert(writes[1].url.endsWith('/client/skus/sku-two'));assert.deepEqual(errors,[]);
 const out=process.argv[2];if(out)await page.screenshot({path:out,fullPage:true});console.log('PASS: two product cells; targeted save, blocked/version preserved, reload, conflict retained; no WB writes');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});

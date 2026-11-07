// TEST: render the patched production FBY panel, refresh, reload and failure with synthetic HTTP.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),previous=path.resolve(process.argv[3]),chunk='assets/fby-export-client-controls-20261107.js';
const html=fs.readFileSync(root+'/web-payload/index.html','utf8'),map=html.match(/<script type="importmap">.*?<\/script>/s)[0];
const server=http.createServer(async(req,res)=>{let rel=new URL(req.url,'http://local').pathname.slice(1);if(rel==='fixture'){res.setHeader('Content-Type','text/html');return res.end(`<html><head>${map}</head><body><div id="root"></div><script type="module">import {r as React,__FbyReactDOM as ReactDOM} from '/assets/admin-tiles-20261019-0.js';import {TestFby} from '/${chunk}';ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(TestFby,{session:{accessToken:'synthetic',user:{id:'u',roleCodes:['OWNER'],permissionCodes:['system:admin'],activeWarehouseId:'w'}}}));</script></body></html>`)}
 try{let data;if(process.env.PUBLIC_URL){const r=await fetch(new URL(rel,process.env.PUBLIC_URL));assert(r.ok);data=await r.text()}else{const p=[root+'/web-payload/',previous+'/web-payload/','D:/WMSFF/_Kof/work/ozon-errors-20261107/web-payload/','D:/WMSFF/_Kof/work/ozon-errors-20261107/web-base/'].map(p=>p+rel).find(fs.existsSync);assert(p,rel);data=fs.readFileSync(p)}
 if(rel===chunk)data=data.toString()+'\nexport {Sa as TestFby};';res.setHeader('Content-Type',rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':'application/octet-stream');res.end(data);
 }catch(e){res.writeHead(500);res.end(String(e))}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true});let passed=0,status='CREATED',fail=false,reads=0,exportFail=false,exports=0;const errors=[];
 try{const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());let data=[];if(url.pathname.endsWith('/clients'))data=[{id:'c',name:'Test',marketplaceConnections:[{marketplace:'YANDEX_MARKET'}]}];
 else if(url.pathname.endsWith('/accounts'))data=[{id:'a',client:{name:'Test'},sellerId:'123'}];
 else if(url.pathname.endsWith('/warehouses'))data=[{id:'w',name:'Test'}];
 else if(url.pathname.endsWith('/requests')){reads++;data=[{id:'r',number:1,title:'FBY fixture',status:'PACKED',warehouseId:'w',items:[{quantity:2}],yandexFbyShipment:{remoteNumber:'100',remoteStatus:status,checkedAt:'2026-11-07T10:00:00Z'}}]}
 else if(url.pathname.endsWith('/refresh')){assert.equal(req.method(),'POST');assert.equal(req.headers().authorization,'Bearer synthetic');if(fail)return route.fulfill({status:502,json:{message:'Яндекс временно недоступен'}});status='FINISHED';data={status,matches:true,differences:[]}}
 else if(url.pathname.endsWith('/export')){exports++;assert.equal(url.pathname,'/api/v1/yandex-fby/accounts/a/requests/r/export');assert.equal(req.headers().authorization,'Bearer synthetic');if(exportFail)return route.fulfill({status:400,json:{message:'Завершите проверку коробов'}});return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:fs.readFileSync(root+'/export-fixture.xlsx')})}
 else if(req.method()!=='GET')throw Error('Unexpected mutation '+url.pathname);await route.fulfill({json:data})});
 await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);await page.getByRole('button',{name:'Сверить с Яндексом',exact:true}).waitFor();assert(await page.locator('.fby-request').innerText().then(s=>s.includes('CREATED')));passed++;
 assert((await page.locator('.fby-request').innerText()).includes('13:00:00'));passed++;
 let prior=reads;await page.getByRole('button',{name:'Сверить с Яндексом',exact:true}).click();await page.locator('.fby-request strong').filter({hasText:'FINISHED'}).waitFor();assert(reads>prior);passed++;
 await page.reload();await page.locator('.fby-request strong').filter({hasText:'FINISHED'}).waitFor();passed++;
 fail=true;await page.getByRole('button',{name:'Сверить с Яндексом',exact:true}).click();await page.getByRole('alert').waitFor();assert((await page.locator('.fby-request').innerText()).includes('FINISHED'));passed++;
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать для Яндекса'}).click();const file=await download;assert.equal(file.suggestedFilename(),'Yandex-FBY-1.xlsx');assert.equal(exports,1);passed++;
 exportFail=true;await page.getByRole('button',{name:'Скачать для Яндекса'}).click();await page.getByRole('alert').filter({hasText:'Завершите проверку коробов'}).waitFor();passed++;
 assert.equal(await page.getByRole('button',{name:'Скачать для Яндекса'}).isEnabled(),true);passed++;
 assert.deepEqual(errors,[]);passed++;fs.writeFileSync(root+(process.env.PUBLIC_URL?'/public-browser-proof.json':'/runtime-browser-proof.json'),JSON.stringify({passed,synthetic:true}));console.log('Browser',passed);
 }finally{await browser.close();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1});

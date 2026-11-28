// TEST: real read-only request projections rendered by the exact release module.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),work=path.resolve(process.argv[2]);
const {chromium}=require('playwright');
const req=require('module').createRequire(path.join(root,'apps/web/package.json'));
const esbuild=require('module').createRequire(req.resolve('vite/package.json'))('esbuild');
(async()=>{const bridge=await esbuild.build({stdin:{contents:'export {default as r} from "react";export * as j from "react/jsx-runtime";export {createRoot as c} from "react-dom/client";',resolveDir:path.join(root,'apps/web')},bundle:true,write:false,format:'esm'});
const rows=JSON.parse(fs.readFileSync(path.join(work,'caption-rows.json'),'utf8'));
assert(rows.some(r=>r.number===3421&&r.editDeadlines[0].readyToShip));assert(rows.some(r=>r.number===3487&&!r.editDeadlines[0].readyToShip));
const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/assets/admin-tiles-20261019-0.js',r=>r.fulfill({contentType:'text/javascript',body:bridge.outputFiles[0].text}));
const base='https://wms.logoff.pro';
if(!process.env.PUBLISHED)await page.route('**/assets/ozon-ready-caption-20261128.*',r=>r.fulfill({contentType:r.request().url().endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(work,'web-payload/assets',path.basename(r.request().url())))}));
await page.route(base+'/__caption_proof',r=>r.fulfill({contentType:'text/html',body:`<html><head><link rel="stylesheet" href="/assets/ozon-ready-caption-20261128.css"></head><body><div id="root"></div><script type="module">import{r,c}from'/assets/admin-tiles-20261019-0.js';import{OzonEditCountdown}from'/assets/ozon-ready-caption-20261128.js';c(document.getElementById('root')).render(r.createElement('main',null,...${JSON.stringify(rows.filter(r=>[3421,3487].includes(r.number)))}.map(x=>r.createElement('section',{'data-number':x.number},r.createElement('h2',null,'№'+x.number),r.createElement(OzonEditCountdown,{orders:x.editDeadlines})))));</script></body></html>`}));
await page.goto(base+'/__caption_proof');const ready=page.locator('[data-number="3421"]');await ready.getByText('Готово к отгрузке',{exact:true}).waitFor();assert.match(await ready.innerText(),/Дата сдачи: 28\.11\.2026, 18:00:00 МСК/);assert(!/дедлайн|Срок получен/i.test(await ready.innerText()));assert.equal(await ready.locator('.is-ready').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(220, 252, 231)');
const pending=page.locator('[data-number="3487"]');assert.match(await pending.innerText(),/дедлайна/);assert.equal(await pending.locator('.is-ready').count(),0);assert.deepEqual(errors,[]);await page.screenshot({path:path.join(work,process.env.PUBLISHED?'published-caption.png':'candidate-caption.png')});console.log('PASS exact module: 3421 green/date; 3487 deadline; no browser errors');}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

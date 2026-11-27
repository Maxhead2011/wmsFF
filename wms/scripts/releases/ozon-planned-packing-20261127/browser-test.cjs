// TEST: compiled planned UI, real React/browser and mocked business API only.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const wms=path.resolve(__dirname,'../../..'),work=process.argv[2];
const req=require('module').createRequire(path.join(wms,'apps/web/package.json'));
const esbuild=require('module').createRequire(req.resolve('vite/package.json'))('esbuild');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const bridge=await esbuild.build({stdin:{contents:'export {default as r} from "react";export * as j from "react/jsx-runtime";export {createRoot as c} from "react-dom/client";',resolveDir:path.join(wms,'apps/web'),loader:'js'},bundle:true,write:false,format:'esm'});
const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],writes=[];let resolves=0,fail=true;
const plan={requestId:'fixture',marketplace:'OZON',title:'Проверка упаковки по плану',phase:'PACKING',plannedPackingRequired:true,packingByProductSupported:true,needed:2,picked:2,packed:0,shortage:0,directions:[{name:'Тест',needed:2,packed:0,items:[{skuId:'s',barcode:'4601234567890',quantity:2,packed:0}]}],lines:[{skuId:'s',barcode:'4601234567890',name:'Товар',needed:2,picked:2,packed:0,remaining:0,requiresKiz:false}],route:[],boxes:[],wholeBoxes:[]};
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{const url=new URL(route.request().url());
if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<html><head><link rel="stylesheet" href="/assets/ozon-planned-components-20261127.css"></head><body><div id="root"></div><script type="module">import{r as React,c}from'/assets/admin-tiles-20261019-0.js';import{FboTwoStagePanel}from'/assets/ozon-planned-components-20261127.js';c(document.getElementById('root')).render(React.createElement(FboTwoStagePanel,{initial:${JSON.stringify(plan)},accessToken:'fixture',userId:'test',canWrite:true,onClose:()=>{},embedded:true}));</script></body></html>`});
if(url.pathname==='/assets/admin-tiles-20261019-0.js')return route.fulfill({contentType:'text/javascript',body:bridge.outputFiles[0].text});
if(url.pathname.startsWith('/assets/ozon-planned-components-'))return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(work,'web',url.pathname))});
if(url.pathname.endsWith('/packing-plan/resolve')){resolves++;return route.fulfill({json:{skuId:'s',barcode:'4601234567890',direction:'Тест',targetBoxCode:'FFL_PLAN_001',cargoId:'123456',packingUnitId:'unit-1',remaining:2}});}
if(route.request().method()==='POST'&&url.pathname.endsWith('/fbo/actions')){writes.push(route.request().postDataJSON());if(fail){fail=false;return route.abort('failed');}plan.packed=1;plan.lines[0].packed=1;return route.fulfill({json:plan});}
if(url.pathname.endsWith('/fbo'))return route.fulfill({json:plan});
return route.fulfill({json:{lines:[],rows:[],items:[],events:[],connections:[],directions:[],differences:[],stock:[]}});
});
await page.goto('https://fixture.test/');await page.getByText('Сканирование в ВМС',{exact:true}).click();
const scan=async v=>{await page.locator('form input').fill(v);await page.getByRole('button',{name:'Подтвердить скан',exact:true}).click();};
await scan('4601234567890');await page.getByRole('status').filter({hasText:'FFL_PLAN_001'}).waitFor();assert.equal(resolves,1);
await scan('FFL_WRONG');await page.getByRole('alert').filter({hasText:'Сканируйте короб FFL_PLAN_001'}).waitFor();assert.equal(writes.length,0);
await page.screenshot({path:path.join(work,'planned-web.png'),fullPage:true});
await scan('123456');await page.getByRole('button',{name:'Повторить неподтверждённый запрос'}).click();await page.waitForFunction(()=>localStorage.getItem('fbo-pending:test:fixture')===null);
assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].packingUnitId,'unit-1');assert.equal(writes[0].targetBoxCode,'FFL_PLAN_001');
await scan('FFL_PLAN_001');await page.getByRole('alert').filter({hasText:'Товар не ожидает упаковки'}).waitFor();assert.equal(writes.length,2);assert.deepEqual(errors,[]);
fs.writeFileSync(path.join(work,'browser-proof.json'),JSON.stringify({passed:true,wrongBoxBlocked:true,duplicateBoxBlocked:true,stableRetry:true,exactUnit:true}));console.log('PASS planned browser flow and stable retry');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

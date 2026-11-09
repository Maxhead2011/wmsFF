// TEST: exact release dialog bundle, real React, synthetic HTTP; no marketplace writes.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict'),{createRequire}=require('module');
const root=path.resolve(process.argv[2]),web=path.resolve('apps/web'),req=createRequire(require.resolve('vite',{paths:[web+'/node_modules']}));
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
(async()=>{
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{FbsSupplyDeliveryDialog}from'${(root+'/web-payload/assets/wb-shipping-search-dialog-20261109.js').replaceAll('\\','/')}';
 const options={shippingPointsEnabled:true,supplies:[{connectionId:'cab',supplyId:'WB-GI-QA',orderCount:4,itemCount:4,destinationOfficeId:'1',destinationOfficeName:'Склад назначения',cargoPlaceIds:['box1']}],offices:[{id:'1',name:'Склад назначения',compatible:true}],requiredDestinationOfficeId:'1',blockers:[]};
 function App(){const[date,setDate]=React.useState('2099-11-09');return React.createElement(FbsSupplyDeliveryDialog,{accessToken:'synthetic',clientId:'client',state:{orders:[{connectionId:'cab',supplyId:'WB-GI-QA',id:'1'}],options,destinationOfficeId:'1',plannedDeliveryDate:date,error:''},isSubmitting:false,onDateChange:setDate,onOfficeChange:()=>{},onCancel:()=>{},onSubmit:()=>{window.sent=true}})}
 createRoot(document.getElementById('qa-root')).render(React.createElement(App));`;
 const built=await req('esbuild').build({stdin:{contents:entry,resolveDir:web,loader:'js'},bundle:true,write:false,plugins:[{name:'test-react',setup(b){b.onResolve({filter:/admin-tiles-20261019-0.js/},()=>({path:'shared',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:"export {default as r} from 'react';",resolveDir:web,loader:'js'}));}}]});
 const css=[...fs.readFileSync(root+'/web-base/index.html','utf8').matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(m=>m[0]).join('');
 const server=http.createServer((r,s)=>{if(r.url==='/qa.js'){s.setHeader('Content-Type','text/javascript');return s.end(built.outputFiles[0].text)}
  if(r.url.startsWith('/assets/')){const file=path.resolve(root+'/web-base'+r.url);assert(file.startsWith(path.resolve(root+'/web-base')+path.sep));s.setHeader('Content-Type',r.url.endsWith('.css')?'text/css':'text/javascript');return s.end(fs.readFileSync(fs.existsSync(file)?file:path.join(process.env.WEB_BASE_FALLBACK,r.url)))}
  s.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><div id="qa-root"></div><script src="/qa.js"></script></body></html>`)}).listen(0,'127.0.0.1');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{const page=await browser.newPage(),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>{const url=route.request().url();calls.push({url,body:route.request().postDataJSON()});return route.fulfill({json:url.endsWith('/shipping-points')?{points:[{id:'42',name:'ПВЗ',address:'Москва, тестовая улица 1',officeType:'pp',available:true},{id:'43',name:'Другой ПВЗ',address:'Москва, 2',officeType:'pp',available:false}]}:url.endsWith('/shipping-cargo')?{saved:true,cargoPlaceIds:['box1','box2']}:{saved:true}})});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('button',{name:'Найти пункты сдачи'}).click();
  assert(await page.locator('option[value="43"]').evaluate(n=>n.disabled));await page.getByLabel('ПВЗ / пункт приёма').selectOption('42');
  await page.getByRole('button',{name:'Сохранить пункт и дату в WB'}).click();await page.getByText('Пункт сдачи и дата сохранены в WB.',{exact:true}).waitFor();
  await page.getByLabel('Итоговое количество грузомест').fill('2');await page.getByRole('button',{name:'Добавить недостающие грузоместа'}).click();await page.getByText(/Грузомест в WB: 2/).waitFor();
  for(const width of [1440,768,375]){await page.setViewportSize({width,height:1000});const bounds=await page.getByRole('dialog').boundingBox();assert(bounds.y>=0&&bounds.y+bounds.height<=1001);assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);await page.screenshot({path:root+`/dialog-${width}.png`})}
  assert.equal(calls.length,3);assert.equal(calls[0].body.shippingPointId,undefined);assert.equal(calls[1].body.shippingPointId,'42');assert.equal(calls[2].body.cargoPlaceTotal,2);assert.deepEqual(errors,[]);
  fs.writeFileSync(root+'/browser-proof.json',JSON.stringify({actualDialog:true,pointSave:true,cargoCreate:true,noPageErrors:true,responsive:true,noStockWrites:true}));console.log('PASS exact dialog: selection, save, cargo, mobile, no page errors');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

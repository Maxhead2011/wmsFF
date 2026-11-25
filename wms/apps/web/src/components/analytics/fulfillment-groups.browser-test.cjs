// TEST: actual component defaults to models, expands variants and keeps parent totals independent of visible rows.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const web=path.resolve(__dirname,'../../..'),req=createRequire(web+'/package.json'),esbuild=createRequire(req.resolve('vite/package.json'))('esbuild');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
test('model, color, size, SKU and kind navigation preserves totals and search',async()=>{
 const result=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {FulfillmentPanel} from './src/components/analytics/FulfillmentPanel';createRoot(document.getElementById('root')).render(<FulfillmentPanel session={{accessToken:'test'}} channel="FBS"/>);`,resolveDir:web,loader:'tsx'},bundle:true,write:false,jsx:'automatic',loader:{'.css':'empty'},format:'iife',plugins:[{name:'api',setup(b){b.onResolve({filter:/\/lib\/api$/},()=>({path:'api',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const request=path=>window.testRequest(path);'}));}}]});
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1450,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div id="root"></div>');await page.addStyleTag({content:fs.readFileSync(__dirname+'/fulfillment.css','utf8')});
  await page.evaluate(()=>{
   const item={name:'Ольга',article:null,size:null,color:null,receivedUnits:100,returnedUnits:0,currentUnits:20,freeUnits:20,shippedUnits:80,shipmentRequests:1,shippingDays:1,averageDaily:1,abc:'A',xyz:'Z',sharePercent:100,currentStorageDays:10,currentAgeCoveragePercent:100,shippedStorageDays:5,shippedAgeCoveragePercent:100,daysOfStock:null,recommendedUnits:30,toReplenish:10,surplusUnits:0,warnings:[],weeklyUnits:[80,0,0,0,0,0,0,0],stockoutDays:null};
   const sku={...item,skuId:'sku',name:'Брюки Ольга',article:'брюки/ольга/беж/50',color:'бежевый',size:'50'};
   const size={...item,skuId:'size',level:'size',color:'бежевый',size:'50',children:['sku'],skuCount:1,recommendationKnownSkus:1,searchText:sku.article};
   const color={...size,skuId:'color',level:'color',size:null,children:['size']};
   const model={...color,skuId:'model',level:'model',color:null,children:['color']};
   const kind={...model,skuId:'kind',level:'kind',name:'Брюки',children:['model']};
   window.testRequest=async path=>path.endsWith('/clients')?[{id:'c',code:'C',name:'Client',warehouses:[{id:'w',name:'FF'}]}]:{generatedAt:'2026-11-25',period:{from:'2026-08-27',to:'2026-11-24'},summary:{products:1,shippedUnits:80,receivedUnits:100,currentUnits:20,freeUnits:20},quality:{completedRequests:1,unclassifiedRequests:0,missingSkuUnits:0},items:[sku],groups:{kind:[kind],model:[model],color:[color],size:[size]}};
  });
  await page.addScriptTag({content:result.outputFiles[0].text});await page.getByRole('button',{name:'Рассчитать',exact:true}).click();
  await page.getByRole('button',{name:'Раскрыть Ольга',exact:true}).waitFor();assert.equal(await page.getByLabel('Детализация').inputValue(),'model');assert.equal(await page.locator('tbody tr').count(),1);
  await page.getByRole('button',{name:'Раскрыть Ольга',exact:true}).click();assert.equal(await page.locator('tbody tr').count(),2);
  await page.getByRole('button',{name:'Раскрыть Ольга · бежевый',exact:true}).click();assert.equal(await page.locator('tbody tr').count(),3);
  await page.getByRole('button',{name:'Раскрыть Ольга · бежевый · 50',exact:true}).click();assert.equal(await page.locator('tbody tr').count(),4);
  assert.match(await page.locator('.ff-kpis').innerText(),/Отгружено, шт\.\s+80/);
  await page.getByLabel('Найти товар').fill('брюки/ольга/беж/50');assert.equal(await page.locator('tbody tr').count(),4);
  await page.getByLabel('Детализация').selectOption('sku');assert.equal(await page.locator('tbody tr').count(),1);assert.match(await page.locator('tbody').innerText(),/Брюки Ольга/);
  await page.getByLabel('Детализация').selectOption('kind');assert.match(await page.locator('tbody').innerText(),/Брюки/);
  await page.getByLabel('Детализация').selectOption('color');assert.equal(await page.locator('tbody tr').count(),1);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

const assert=require('node:assert/strict'),{test}=require('node:test');
const esbuild=require(process.env.ESBUILD_MODULE||'esbuild'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
// TEST: an older branch response must not overwrite the report after switching back to Moscow.
test('keeps the current warehouse when overlap reports resolve out of order',async()=>{
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{ClientRequestsPanel}from'./ClientRequestsPanel';
 const root=createRoot(document.querySelector('main'));window.branch=id=>root.render(<ClientRequestsPanel session={{accessToken:'test',user:{id:'u',roleCodes:['OWNER'],permissionCodes:['system:admin','client-requests:read'],activeWarehouseId:id}}} onOpenFbsOrders={()=>{}}/>);window.branch('moscow');`;
 const js=await esbuild.build({stdin:{contents:entry,loader:'tsx',resolveDir:__dirname},bundle:true,outfile:'test.js',write:false,jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{
  const page=await browser.newPage();page.setDefaultTimeout(6000);const waiting=[];
  await page.route('**/*',async r=>{
   const p=new URL(r.request().url()).pathname;
   if(p==='/')return r.fulfill({body:'<main></main>',contentType:'text/html'});
   if(p.endsWith('/box-overlaps')){waiting.push(r);return;}
   return r.fulfill({json:[]});
  });
  await page.goto('http://fixture.test');await page.addScriptTag({content:js.outputFiles[0].text});
  async function next(){for(let i=0;i<100&&!waiting.length;i++)await new Promise(ok=>setTimeout(ok,30));assert(waiting.length);return waiting.shift();}
  async function reply(r,count){await r.fulfill({json:{generatedAt:new Date().toISOString(),activeRequestsCount:count,checkedRequestsCount:count,overlappingBoxesCount:0,requestsWithOverlapsCount:0,overlaps:[],errors:[],statusCounts:[]}});}
  const summary=page.locator('.box-overlap-panel summary');await reply(await next(),9);await summary.getByText(/9 из 9/).waitFor();
  await page.evaluate(()=>window.branch('noginsk'));const old=await next();assert.equal(await summary.count(),0);
  await page.evaluate(()=>window.branch('moscow'));await reply(await next(),8);await summary.getByText(/8 из 8/).waitFor();
  await reply(old,20);await page.waitForLoadState('networkidle');assert.match(await summary.innerText(),/8 из 8/);
 }finally{await browser.close();}
});

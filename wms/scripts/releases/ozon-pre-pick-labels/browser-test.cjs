// TEST: the exact candidate/public minified handler in a real browser; all business requests are fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(process.argv[2]);
const code=fs.readFileSync(path.join(root,'web/assets/ozon-pre-pick-fbs-20261125.js'),'utf8');
const helper=code.slice(0,code.indexOf('import{'));
const mark=code.indexOf('const pending=o.filter'),start=code.lastIndexOf('async function ',mark),end=code.indexOf('async function ',mark);
assert(start>0&&end>start);const handler=code.slice(start,end),name=/async function (\w+)/.exec(handler)[1];
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});try{
 const page=await browser.newPage();let accept=true,fail=false,marked=false;const requests=[];
 page.on('dialog',d=>accept?d.accept():d.dismiss());
 await page.route('**/*',route=>{
  if(route.request().url()==='https://fixture.test/')return route.fulfill({contentType:'text/html',body:'<html><body>Exact published FBS handler fixture</body></html>'});
  assert(route.request().url().endsWith('/api/v1/marketplace-connections/fbs/orders/prepare-labels'),'Unexpected network request');
  const body=route.request().postDataJSON();requests.push(body);
  return route.fulfill({status:fail?503:200,json:fail?{message:'fixture preparation failed'}:{prepared:marked?0:1,requiresPhysicalSubmission:marked?body.orders:[]}});
 });
 await page.goto('https://fixture.test/');
 await page.evaluate(({helper,handler,name})=>{
  const events=[];const empty=()=>{};
  const args={f:'client',s:{accessToken:'fixture'},be:empty,Fe:empty,ie:empty,le:message=>{if(message)events.push('error:'+message)},ke:o=>o.id,
   en:async()=>events.push('physical-submit'),__downloadWbAllLabels:async()=>{events.push('labels');return {warnings:[]}},openWbRibbonPrint:async()=>events.push('print')};
  window.fixture={events,run:new Function(...Object.keys(args),helper+handler+';return '+name)(...Object.values(args))};
 },{helper,handler,name});
 async function run(status='awaiting_packaging',marketplace='OZON'){await page.evaluate(async({status,marketplace})=>{window.fixture.events.length=0;await window.fixture.run([{id:'o',connectionId:'c',marketplace,supplierStatus:status}],'print');},{status,marketplace});return page.evaluate(()=>window.fixture.events);}
 assert.deepEqual(await run(),['labels','print']);assert.deepEqual(requests[0],{clientId:'client',orders:[{connectionId:'c',id:'o'}]});
 accept=false;const count=requests.length;assert.deepEqual(await run(),[]);assert.equal(requests.length,count);
 accept=true;fail=true;assert.deepEqual(await run(),['error:fixture preparation failed']);fail=false;
 assert.deepEqual(await run('awaiting_deliver'),['labels','print']);assert.equal(requests.length,count+1);
 marked=true;assert.deepEqual(await run(),['physical-submit','labels','print']);marked=false;
 assert.deepEqual(await run('confirm','WILDBERRIES'),['labels','print']);
 console.log('PASS: exact runtime browser handler: preparation, cancellation, failure, reprint, marked path, WB; no business writes');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

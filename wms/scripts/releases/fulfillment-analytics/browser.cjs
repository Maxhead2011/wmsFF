const releaseDir=require('node:path').resolve(process.argv[2]||'.');
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=process.env.PUBLIC_URL||'http://127.0.0.1:55104/',live=process.env.FULFILLMENT_LIVE==='true';
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
 const session=live?JSON.parse(fs.readFileSync(releaseDir+'/private-session.json','utf8')):{accessToken:'fixture',user:{id:'fixture',name:'Test client',roleCodes:['CLIENT'],permissionCodes:[],clientScopeMode:'LIMITED',clientIds:['own'],writableClientIds:[],warehouseIds:[],fulfillmentAnalyticsEnabled:true,analyticsEnabled:true}};
 await page.addInitScript(s=>{localStorage.setItem('logoff-wms-session',JSON.stringify(s));},session);
 await page.route('**/api/**',async route=>{
  const request=route.request(),p=new URL(request.url()).pathname;calls.push({method:request.method(),path:p});
  if(request.method()!=='GET')return route.abort();if(live)return route.continue();
  let data=[];
  if(p.endsWith('/auth/me'))data=session.user;
  if(p.endsWith('/analytics/fulfillment/clients'))data=[{id:'own',code:'CL1',name:'Test client',warehouses:[{id:'ff',name:'Test FF'}]}];
  if(p.endsWith('/analytics/fulfillment/dashboard')){
   assert(!new URL(request.url()).searchParams.has('refresh'));
   const fbo=new URL(request.url()).searchParams.get('channel')==='FBO';
   data={generatedAt:'2026-11-25T10:00:00Z',period:{from:'2026-08-27',to:'2026-11-24'},summary:{products:1,receivedUnits:1000,shippedUnits:840,currentUnits:100,freeUnits:60},quality:{completedRequests:84,unclassifiedRequests:0,missingSkuUnits:0},items:[{skuId:'a',name:'Test product',article:'ABC',receivedUnits:1000,returnedUnits:0,currentUnits:100,freeUnits:60,shippedUnits:840,shipmentRequests:84,shippingDays:84,averageDaily:10,abc:'A',xyz:'X',sharePercent:100,currentStorageDays:12,currentAgeCoveragePercent:100,shippedStorageDays:10,shippedAgeCoveragePercent:100,daysOfStock:6,recommendedUnits:fbo?null:170,toReplenish:fbo?null:110,surplusUnits:fbo?null:0,warnings:[],weeklyUnits:[70,70,70,70,70,70,70,70],stockoutDays:0}]};
  }
  return route.fulfill({json:data});
 });
 await page.goto(url,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Аналитика',exact:true}).first().click();
 await page.getByRole('heading',{name:'Аналитика отгрузок ФБС',exact:true}).waitFor();
 if(live){await page.getByLabel('Клиент',{exact:true}).selectOption(session.probe.clientId);await page.getByLabel('Склад ФФ',{exact:true}).selectOption(session.probe.warehouseId);}
 await page.getByRole('button',{name:'Рассчитать',exact:true}).click();
 await page.locator('.ff-report tbody tr').first().waitFor();assert.equal(await page.getByRole('columnheader',{name:'Довезти, шт.',exact:true}).count(),1);
 if(!live){assert.match(await page.locator('.ff-report tbody').innerText(),/170\s+110/);}
 await page.screenshot({path:releaseDir+(live?'/published.png':'/candidate.png'),fullPage:true});
 await page.getByRole('button',{name:'Отгрузки ФБО',exact:true}).click();await page.getByRole('heading',{name:'Аналитика отгрузок ФБО',exact:true}).waitFor();if(live){await page.getByLabel('Клиент',{exact:true}).selectOption(session.probe.clientId);await page.getByLabel('Склад ФФ',{exact:true}).selectOption(session.probe.warehouseId);}await page.getByRole('button',{name:'Рассчитать',exact:true}).click();await page.getByText('Как читать ABC/XYZ, сроки хранения и рекомендованный остаток').waitFor();assert.equal(await page.getByRole('columnheader',{name:'Довезти, шт.',exact:true}).count(),0);
 await page.getByRole('button',{name:'Wildberries',exact:true}).click();
 if(!live){await page.waitForFunction(()=>document.querySelector('.analytics-panel')||document.body.innerText.includes('Нет доступных клиентов'));assert(calls.some(c=>c.path.endsWith('/analytics/clients')));}
 await page.getByRole('button',{name:'Отгрузки ФБС',exact:true}).click();await page.getByRole('heading',{name:'Аналитика отгрузок ФБС',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.ff-report').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
 assert.deepEqual(errors,[]);const result={passed:true,live,fullApp:true,threeTabs:true,recommendations:true,mobile:true,noMutationsSent:true,errors};fs.writeFileSync(releaseDir+(live?'/live-browser.json':'/candidate-browser.json'),JSON.stringify(result));console.log(JSON.stringify(result));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

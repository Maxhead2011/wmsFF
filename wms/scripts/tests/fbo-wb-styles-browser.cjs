// TEST: cold FBO entry must load request styling without visiting the legacy Requests menu.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const origin='https://wms.logoff.pro',errors=[],writes=[],requests=[];
const client={id:'demo',code:'CL-DEMO',name:'Учебный клиент',status:'ACTIVE',marketplaceConnections:[{marketplace:'WILDBERRIES',isActive:true},{marketplace:'OZON',isActive:true}],lamodaAccounts:[{isActive:true,fboEnabled:true}]};
const user={id:'fbo-style-fixture',email:'fixture@example.invalid',name:'Тест',roleCodes:['OWNER'],permissionCodes:['system:admin','client-requests:read','client-requests:write','stock:read','catalog:read'],clientScopeMode:'LIMITED',clientIds:['demo'],writableClientIds:['demo'],warehouseIds:[],writableWarehouseIds:[]};
const isClient=process.env.TEST_ROLE==='CLIENT';
if(isClient){user.roleCodes=['CLIENT'];user.permissionCodes=['clients:read','client-requests:read','client-requests:write','stock:read','catalog:read','fbs:read'];}
const item={id:'item',skuId:'sku',quantity:10,pickedQuantity:6,packedQuantity:0,sku:{id:'sku',name:'Учебная футболка',article:'DEMO',clientSku:'DEMO',barcodes:[]}};
const request={id:'fixture-request',number:2493,title:'Учебная сборка',type:'OUTBOUND',status:'IN_PROGRESS',priority:'NORMAL',clientId:'demo',client,createdAt:'2026-10-28T08:00:00Z',updatedAt:'2026-10-28T08:00:00Z',plannedAt:'2026-10-28T08:00:00Z',destinationCity:'Москва',items:[item],packages:[],files:[],_count:{items:1,fbsOrderLinks:0}};
if(isClient)request.status='SUBMITTED';
const fbo={requestId:request.id,number:2493,title:request.title,marketplace:'WILDBERRIES',phase:'PICKING',needed:10,picked:6,packed:0,looseRemaining:6,shortage:0,route:[],boxes:[],wholeBoxes:[],history:[],pickedUnits:[],pickedUnitsCount:0,directions:[],observedAt:'2026-10-28T08:00:00Z',lines:[{id:'item',skuId:'sku',name:'Учебная футболка',barcode:'2000000000000',needed:10,picked:6,packed:0,remaining:4}]};
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let page;try{
 const context=await browser.newContext({viewport:{width:1600,height:1100}});
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.pathname.startsWith('/api/')){
   const p=url.pathname.replace(/^\/api(?:\/v1)?/,'');requests.push(p);if(req.method()!=='GET'){writes.push(p);return route.abort();}let data=[];
   if(p==='/auth/me')data=user;else if(p==='/clients')data=[client];
   else if(p==='/client-requests')data=[request];
   else if(p==='/client-requests/fbo-active-counts')data={wb:1,ozon:0,lamoda:0};
   else if(p.includes('box-overlaps'))data={errors:[],requests:[],overlaps:[],checkedRequestsCount:1,activeRequestsCount:1,overlappingBoxesCount:0,requestsWithOverlapsCount:0};
   else if(p==='/tsd/requests/'+request.id)data={request,items:[],fbo};
   else if(p==='/tsd/requests/'+request.id+'/fbo')data=fbo;
   else if(p==='/lamoda/accounts')data=[];
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  }
  if(url.origin!==origin)return route.abort();
  if(url.pathname==='/'&&process.env.HTML_OVERLAY)return route.fulfill({contentType:'text/html',body:fs.readFileSync(process.env.HTML_OVERLAY)});
  return route.continue();
 });
 await context.addInitScript(({u,theme})=>{localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'educational-fixture',tokenType:'Bearer',user:u}));localStorage.setItem('logoff-wms-ui-theme:'+u.id,theme);localStorage.setItem('logoff-wms-ui-style:la_panthera:'+u.id,'light');},{u:user,theme:process.env.TEST_THEME||'modern'});
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 if(process.env.TEST_THEME==='la_panthera')await page.locator('aside summary').filter({hasText:/маркетплейсы/i}).click();
 await page.locator('aside').getByRole('button',{name:'FBO',exact:true}).click();
 await page.getByRole('button',{name:/FBO WB/}).click();await page.getByRole('button',{name:isClient?'Редактировать':'Онлайн',exact:true}).waitFor();
 await page.screenshot({path:out+'/list.png',fullPage:true});
 const metrics=await page.locator('.client-request-sortbar').evaluate(e=>{const s=getComputedStyle(e);return {display:s.display,gap:s.gap,padding:s.padding,borderRadius:s.borderRadius}});
 if(isClient){
  // TEST: customer controls use the same missing stylesheet but retain customer permissions.
  assert.equal(metrics.display,'flex');assert.ok(parseFloat(metrics.gap)>=8);
  const action=await page.getByRole('button',{name:'Редактировать',exact:true}).evaluate(e=>{const s=getComputedStyle(e);return {radius:parseFloat(s.borderRadius),display:s.display};});
  assert.ok(action.radius>=6);assert.ok(['flex','inline-flex'].includes(action.display));
  assert.equal(await page.getByRole('button',{name:'Онлайн',exact:true}).count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  fs.writeFileSync(out+'/proof.json',JSON.stringify({passed:7,role:'CLIENT',theme:process.env.TEST_THEME||'modern',syntheticApi:true,metrics,action,writes,errors},null,2));
  console.log('FBO WB customer styles: 7 checks passed');return;
 }
 await page.getByRole('button',{name:'Онлайн',exact:true}).click();await page.locator('.online-execution-modal').waitFor();
 await page.getByText('Учебная футболка',{exact:false}).last().waitFor();await page.waitForTimeout(400);
 await page.screenshot({path:out+'/online.png',fullPage:true});
 const modal=await page.locator('.online-execution-modal').evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {position:s.position,display:s.display,x:r.x,y:r.y,width:r.width,height:r.height,viewport:[innerWidth,innerHeight]}});
 fs.writeFileSync(out+'/diagnostic.json',JSON.stringify({metrics,modal,errors,requests,writes},null,2));
 assert.equal(modal.position,'fixed','online assembly must float above the page');
 assert.equal(metrics.display,'flex','sort controls must keep their flex layout');
 assert.ok(parseFloat(metrics.gap)>=8,'sort controls must retain spacing');
 assert.ok(modal.y>=0&&modal.y<modal.viewport[1]);
 await page.locator('.online-execution-modal__header').getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.locator('.online-execution-modal').waitFor({state:'detached'});
 const action=await page.getByRole('button',{name:'Онлайн',exact:true}).evaluate(e=>{const s=getComputedStyle(e);return {display:s.display,radius:parseFloat(s.borderRadius),transition:s.transitionDuration};});
 assert.ok(action.radius>=6,'action buttons must retain rounded styling');
 for(const width of [768,390]){
  await page.setViewportSize({width,height:900});await page.getByRole('button',{name:'Онлайн',exact:true}).click();
  const popup=page.locator('.online-execution-modal');await popup.waitFor();
  const bounds=await popup.locator('.online-execution-modal__panel').boundingBox();
  assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1,'modal must fit viewport '+width);
  await popup.locator('.online-execution-modal__header').getByRole('button',{name:'Закрыть',exact:true}).click();await popup.waitFor({state:'detached'});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 fs.writeFileSync(out+'/proof.json',JSON.stringify({passed:9,theme:process.env.TEST_THEME||'modern',syntheticApi:true,metrics,modal,action,writes,errors},null,2));console.log('FBO WB styles: 9 checks passed');
 }catch(e){if(page){fs.writeFileSync(out+'/failure.txt',await page.locator('body').innerText());await page.screenshot({path:out+'/failure.png',fullPage:true});}fs.writeFileSync(out+'/errors.json',JSON.stringify({errors,requests,writes}));throw e;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

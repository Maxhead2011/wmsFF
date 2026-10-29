// TEST: published shell/candidate bundle with isolated API fixtures only.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),out=root+(process.env.WEB_ORIGIN?'/public-browser':'/browser');fs.mkdirSync(out,{recursive:true});
const user={id:'test',name:'Test',roleCodes:['OWNER'],permissionCodes:['system:admin','client-requests:read','client-requests:write','stock:read','stock:write'],clientScopeMode:'LIMITED',clientIds:['demo'],writableClientIds:['demo'],warehouseIds:[],writableWarehouseIds:[]};
let passed=0,prints=0,confirmations=0,sends=0,payload=null;const errors=[];
const unit={id:'unit52',skuId:'sku',sourceBarcode:'2053244002604',kiz:'physical-kiz',pickedByUserId:'test',printStatus:null,label:{name:'Пальто бордовое',size:'52',article:'MP52',barcode:'4640684266611'}};
const plan={requestId:'request',number:2506,title:'Lamoda test',marketplace:'LAMODA',phase:'PACKING',needed:1,picked:1,packed:0,shortage:0,route:[],boxes:[],wholeBoxes:[],history:[],lines:[{id:'i',skuId:'sku',name:'Пальто бордовое',barcode:'2053244002604',needed:1,picked:1,packed:0,remaining:0}],directions:[],relabelRequired:true,relabelUnits:[unit]};
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://test').pathname;let file=path.resolve(root+'/web/payload','.'+name);if(!file.startsWith(root+path.sep))return res.end();if(!fs.existsSync(file))file=path.resolve(root+'/web-base','.'+name);if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=root+'/web/payload/index.html';res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=process.env.WEB_ORIGIN||'http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});let page;
 try{const context=await browser.newContext({viewport:{width:1440,height:1050}});await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(!url.pathname.startsWith('/api/'))return url.origin===origin?route.continue():route.abort();const p=url.pathname.replace(/^\/api(?:\/v1)?/,'');let data=[];
  if(p==='/auth/me')data=user;
  else if(p==='/clients')data=[{id:'demo',status:'ACTIVE',clientKind:'LEGAL_ENTITY',code:'TEST',name:'Учебный клиент',marketplaceConnections:[],lamodaAccounts:[{isActive:true,fboEnabled:true}]}];
  else if(p==='/lamoda/accounts')data=[{id:'a',clientId:'demo',name:'Lamoda',sellerId:'test',isActive:true,fboEnabled:true}];
  else if(p==='/lamoda/accounts/a')data={products:[],documents:[],plans:[{id:'p',title:'Переклейка',warehouse:{name:'ФФ Москва'},createdAt:new Date().toISOString(),items:[{quantity:1}],assembly:{requestId:'request',request:{number:2506,status:'IN_WORK'}}}],exchanges:[],assemblyEnabled:true,limits:{products:1000,documents:500,plans:100}};
  else if(p==='/lamoda/accounts/a/warehouses')data=[{id:'msk',name:'ФФ Москва'}];
  else if(p==='/tsd/requests/request/fbo')data=plan;
  else if(p==='/tsd/requests/request/fbo/lamoda-relabel/resolve'){const b=req.postDataJSON();assert.equal(b.barcode,'2053244002604');assert.equal(b.kiz,'physical-kiz');data=unit;}
  else if(p==='/tsd/requests/request/fbo/lamoda-relabel/stations')data=[{id:'station',name:'Склад',printerName:'Printer'}];
  else if(p==='/tsd/requests/request/fbo/lamoda-relabel/print'){const b=req.postDataJSON();assert.equal(b.unitId,'unit52');assert.equal(b.stationId,'station');assert(b.printId);prints++;unit.printStatus='PRINTED';data={printId:b.printId,status:'QUEUED'};}
  else if(p==='/tsd/requests/request/fbo/actions'){const b=req.postDataJSON();assert.equal(b.action,'RELABEL_UNIT');assert.equal(b.relabelUnitId,'unit52');assert.equal(b.barcode,'4640684266611');assert.equal(b.kiz,'physical-kiz');confirmations++;plan.relabelUnits=[];data=plan;}
  else if(p.endsWith('/submission'))data={receipt:null,remoteShipmentId:null,items:[{skuId:'sku',name:'Coat',size:'52',quantity:1}]};
  else if(p.endsWith('/submission/preview')){const b=req.postDataJSON();assert.equal(b.prices[0].priceMinor,10050);payload={...b,items:[{externalSku:'SELLER52',ean:'4640684266611',quantity:1,price:{amount:10050}}]};data={payload};}
  else if(p.endsWith('/submission/send')){sends++;assert.equal(req.postDataJSON().externalShipmentId,'UPD-1');data={state:'SUCCEEDED',remoteId:'MPG1',payload,updatedAt:new Date().toISOString()};}
  else if(p.endsWith('/submission/refresh'))data={state:'SUCCEEDED',remoteId:'MPG1',remoteStatus:'VALIDATION',payload,updatedAt:new Date().toISOString()};
  else if(req.method()!=='GET')throw Error('Unexpected write '+p);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });await context.addInitScript(u=>{localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'isolated-test',tokenType:'Bearer',user:u}));localStorage.setItem('logoff-wms-ui-theme:'+u.id,'modern');},user);
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin,{waitUntil:'domcontentloaded',timeout:60000});await page.locator('aside').getByRole('button',{name:'FBO',exact:true}).click();await page.getByRole('button',{name:/lamoda/}).click();await page.getByRole('button',{name:'Открыть сборку',exact:true}).click();
 const pane=page.getByRole('region',{name:'Оформление поставки Lamoda'});await pane.waitFor();
 await pane.getByLabel('Номер поставки / УПД',{exact:true}).fill('UPD-1');await pane.getByLabel('Дата поставки',{exact:true}).fill('2026-11-01');await pane.getByLabel('Цена Coat',{exact:true}).fill('100,50');
 assert.equal(await pane.getByRole('button',{name:'Создать поставку в Lamoda',exact:true}).count(),0);passed++;
 await pane.getByRole('button',{name:'Проверить фактический состав',exact:true}).click();await pane.getByText('SELLER52',{exact:true}).waitFor();passed++;
 const send=pane.getByRole('button',{name:'Создать поставку в Lamoda',exact:true});assert(await send.isDisabled());passed++;
 await pane.getByRole('checkbox').check();assert(await send.isEnabled());await send.click();await pane.getByText(/Поставка создана/).waitFor();assert.equal(sends,1);passed++;
 assert.equal(await pane.getByRole('button',{name:'Создать поставку в Lamoda',exact:true}).count(),0);passed++;
 await pane.getByRole('button',{name:'Обновить статус Lamoda',exact:true}).click();await pane.getByText(/Проверка Lamoda/).waitFor();passed++;
 assert.deepEqual(errors,[]);await page.screenshot({path:out+'/submission.png'});
 fs.writeFileSync(root+(process.env.WEB_ORIGIN?'/public-browser-proof.json':'/browser-proof.json'),JSON.stringify({passed,isolatedApi:true}));console.log(JSON.stringify({passed,isolatedApi:true}));
 }catch(e){console.error(errors);if(page){fs.writeFileSync(out+'/failure.txt',await page.locator('body').innerText());await page.screenshot({path:out+'/failure.png'});}throw e;}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});

// TEST: actual published module graph, candidate import island and synthetic API only.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),publicMode=process.argv.includes('--public'),baseline=process.argv.includes('--baseline'),origin='https://wms.logoff.pro';
const errors=[],unexpected=[];let creates=0,sends=0,ready=false;
async function bytes(n){if(!publicMode)for(const folder of baseline?['web-base','browser-cache']:['web-payload','web-base','browser-cache']){const p=path.join(root,folder,n);if(fs.existsSync(p))return fs.readFileSync(p);}const r=await fetch(origin+'/'+n);assert(r.ok,n);const b=Buffer.from(await r.arrayBuffer()),p=path.join(root,'browser-cache',n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);return b;}
const user={id:'test',name:'Тест',roleCodes:['CLIENT'],permissionCodes:['client-requests:read','client-requests:write'],clientScopeMode:'LIMITED',clientIds:['c'],writableClientIds:['c'],activeWarehouseId:null};
const preview={items:[{skuId:'sku',name:'Платье'}],totalQuantity:10,directions:[{name:'Москва',items:[{skuId:'sku',barcode:'123',quantity:10}]}]};
(async()=>{
 const html=(await bytes('index.html')).toString(),map=JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]),core=map.imports['/assets/admin-tiles-20261019-0.js'],links=(html.match(/<link[^>]*rel="stylesheet"[^>]*>/g)||[]).join('');
 const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext({viewport:{width:1440,height:1050}});await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname.replace(/^\/api(?:\/v1)?/,''),json=(v,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(v)});
  if(u.pathname.startsWith('/api/')){
   if(p==='/clients')return json([{id:'c',code:'CL-TEST',name:'Тестовый клиент',status:'ACTIVE',marketplaceConnections:[{marketplace:'OZON',isActive:true}]}]);
   if(p.endsWith('/capability'))return json({enabled:!p.startsWith('/client-request-removal')});
   if(p==='/ozon-fbo-import/warehouses')return json([{id:'w',name:'Москва'}]);
   if(p==='/ozon-fbo-import/requests')return json([]);
   if(p.endsWith('/link-connections'))return json([{id:'conn',sellerId:'42'}]);
   if(p.endsWith('/links/preview'))return json({...preview,previewHash:'hash',place:'Москва',date:'2026-11-01T09:00:00Z',orders:[{orderId:'42',orderNumber:'42-1'}],existingRequest:null});
   if(p==='/ozon-fbo-import/preview')return json(preview);
   if(p==='/client-requests/availability-preview'){assert.equal(req.postDataJSON().items[0].quantity,10);return json({canCommit:false,summary:{requestedQuantity:10,shortageQuantity:3},lines:[{skuId:'sku',name:'Платье',barcode:'123',requestedQuantity:10,stockQuantity:9,reservedQuantity:2,availableQuantity:7,pendingPlacementQuantity:2,shortageQuantity:3}]});}
   if(p.endsWith('/commit')){const body=req.postData()||"";const decision=p.includes("/links/")?JSON.parse(req.postDataJSON().stockDecision):JSON.parse(body.match(/name="stockDecision"\r?\n\r?\n([^\r\n]+)/)[1]);assert.equal(decision.mode,creates===0?"AS_IS":"OPEN_CORRECTION");assert.equal(decision.lines[0].shortageQuantity,3);creates++;return json({request:{id:'r',number:100},existing:false});}
   if(p.endsWith('/ozon-adjustment'))return json({operation:null});
   if(p.endsWith('/ozon-adjustment/preview'))return json({token:'fresh',needed:10,after:7,lines:[{skuId:'sku',name:'Платье'}],rows:[{direction:'Москва',skuId:'sku',barcode:'123',before:10,packed:0,after:7}]});
   if(p.endsWith('/ozon-adjustment/start')){sends++;assert.equal(req.postDataJSON().confirm,true);return json({operation:{state:'APPLIED',operations:[{supplyId:'s',state:'SUCCESS'}]}});}
   if(p.endsWith('/supply/bind')||p.endsWith('/supply/mapping'))ready=true;
   if(p.includes('/supply'))return json({directions:preview.directions,connections:[{id:'conn',sellerId:'42'}],differences:[],link:ready?{connectionId:'conn',orderId:'42',orderNumber:'42',place:'Москва',date:'2026-11-01',state:'DATA_FILLING',mapping:{Москва:'s'},supplies:[{id:'s',name:'Москва',items:[{barcode:'123',quantity:10}]}],operations:{}}:null});
   if(p==='/notifications/unread-count')return json({count:0});
   if(['/auth/me','/auth/refresh'].includes(p))return json({message:'Synthetic fixture'},401);
   if(['/features','/settings'].includes(p))return json({});
   unexpected.push(req.method()+' '+p);return json({message:'Unexpected API'},500);
  }
  if(u.origin!==origin)return route.abort();
  if(u.pathname==='/__ozon_import_stock')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><script type="importmap">'+JSON.stringify(map)+'</script>'+links+'</head><body><div id="root" hidden></div><div id="fixture"></div></body></html>'});
  try{let b=await bytes(u.pathname.slice(1));if(u.pathname===core){const s=b.toString(),alias=s.match(/([\w$]+)\.createRoot\(document\.getElementById\("root"\)\)/)?.[1];assert(alias);b=Buffer.from(s+'\nexport {'+alias+' as __TestReactDOM};');}return route.fulfill({contentType:({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[path.extname(u.pathname)]||'application/octet-stream',body:b});}catch(e){errors.push(String(e));return route.abort();}
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});await page.goto(origin+'/__ozon_import_stock');
 await page.evaluate(async user=>{const main=await import('/assets/admin-tiles-20261019-0.js'),ozon=await import('/assets/admin-tiles-20261019-14.js');main.__TestReactDOM.createRoot(document.getElementById('fixture')).render(main.r.createElement(ozon.OzonFboPanel,{session:{accessToken:'synthetic',user}}));},user);
 await page.locator('.ozfbo-client-picker select').selectOption('c');await page.getByRole('button',{name:'Создать сборку',exact:true}).click();
 const link=page.getByRole('region',{name:'Создать сборку по ссылке Ozon'});await link.getByLabel('Ссылка на заявку Ozon').fill('https://seller.ozon.ru/app/supply/orders/42');await link.getByRole('button',{name:'Получить состав из Ozon'}).click();
 await page.getByRole('region',{name:'Проверка остатков Ozon'}).waitFor();if(baseline)throw Error('Baseline unexpectedly passed');
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:1050});await page.getByRole('button',{name:'Сформировать как есть',exact:true}).scrollIntoViewIfNeeded();assert(await page.getByRole('button',{name:'Сформировать как есть',exact:true}).isVisible());}
 await page.setViewportSize({width:1440,height:1050});await page.screenshot({path:root+'/'+(publicMode?'public-':'')+'stock-review.png',fullPage:true});
 await link.getByRole('button',{name:'Сформировать как есть',exact:true}).click();await link.getByText('Сборка №100 создана.',{exact:true}).waitFor();assert.equal(creates,1);assert.equal(sends,0);
 await link.getByRole('button',{name:'Получить состав из Ozon'}).click();await link.getByRole('button',{name:'Скорректировать по фактическим остаткам',exact:true}).click();const correction=link.getByRole('region',{name:'Корректировка созданной заявки'});await correction.getByText(/Было 10 шт/).waitFor();assert.equal(sends,0);
 await correction.getByLabel('Подтверждаю изменение количества в заявке WMS и в поставках Ozon').check();await correction.getByRole('button',{name:'Применить в WMS и Ozon'}).click();await correction.getByText('План WMS и Ozon скорректирован',{exact:true}).waitFor();assert.equal(sends,1);
 await page.getByRole('button',{name:'Из файла',exact:true}).click();await page.getByLabel('Место общей отгрузки').fill('Москва');await page.locator('input[type=file]').setInputFiles({name:'plan.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic')});await page.getByRole('button',{name:'Проверить файл',exact:true}).click();await page.getByRole('button',{name:'Скорректировать по фактическим остаткам',exact:true}).filter({visible:true}).click();
 const file=page.locator('details.client-request-excel-collapse');await file.getByText('Привяжите поставку Ozon и сохраните соответствия направлений, чтобы перейти к расчёту уменьшения.',{exact:true}).waitFor();assert.equal(creates,3);assert.equal(sends,1);
 await file.getByLabel('Ссылка или ID заявки Ozon из адреса кабинета').fill('42');await file.getByRole('button',{name:'Добавить заявку Ozon'}).click();await file.getByText(/Было 10 шт/).waitFor();assert.equal(sends,1);
 assert.equal(await file.getByRole('button',{name:'Передать короба в Ozon'}).count(),0);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 const proof={passed:10,syntheticApi:true,creates,sends,publicMode,errors,unexpected};fs.writeFileSync(root+'/'+(publicMode?'public-':'')+'browser-proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);console.error(errors,unexpected);process.exitCode=1});

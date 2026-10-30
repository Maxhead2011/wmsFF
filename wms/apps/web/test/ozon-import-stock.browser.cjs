// TEST: both imports, full demand despite shortage, deferred external confirmation, errors and stale replies.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
 try{
 const page=await browser.newPage({viewport:{width:1400,height:1050}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
 page.on('requestfailed',r=>console.error('Failed '+r.url()+' '+r.failure()?.errorText));
 let creates=0,external=0,failStock=false,delayStock=false,releaseStock,received;
 const p={items:[{skuId:'s',name:'Платье'}],totalQuantity:10,directions:[{name:'A',items:[{skuId:'s',barcode:'123',quantity:6}]},{name:'B',items:[{skuId:'s',barcode:'123',quantity:4}]}]};
 const stock={canCommit:false,summary:{requestedQuantity:10,shortageQuantity:3},lines:[{skuId:'s',name:'Платье',barcode:'123',requestedQuantity:10,stockQuantity:9,reservedQuantity:2,availableQuantity:7,pendingPlacementQuantity:2,shortageQuantity:3}]};
 await page.route('**/api/v1/**',async route=>{
  const r=route.request(),path=new URL(r.url()).pathname,j=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(path.endsWith('/capability'))return j({enabled:true});
  if(path.endsWith('/warehouses'))return j([{id:'w',name:'Москва'}]);
  if(path.endsWith('/link-connections'))return j([{id:'conn',sellerId:'42',accountName:'Магазин'}]);
  if(path.endsWith('/links/preview'))return j({...p,previewHash:'hash',place:'Москва',date:'2026-11-01T09:00:00Z',orders:[{orderId:'42',orderNumber:'42-1'}],existingRequest:null});
  if(path.endsWith('/ozon-fbo-import/preview'))return j(p);
  if(path.endsWith('/availability-preview')){received=r.postDataJSON();if(delayStock)await new Promise(resolve=>releaseStock=resolve);return j(failStock?{message:'Остатки временно недоступны'}:stock,failStock?503:200);}
  if(path.endsWith('/commit')){creates++;return j({request:{id:'r',number:100},existing:false});}
  if(path.endsWith('/ozon-adjustment'))return j({operation:null});
  if(path.endsWith('/ozon-adjustment/preview'))return j({token:'fresh',needed:10,after:7,lines:stock.lines,rows:[{direction:'A',skuId:'s',barcode:'123',before:6,packed:0,after:4},{direction:'B',skuId:'s',barcode:'123',before:4,packed:0,after:3}]});
  if(path.endsWith('/ozon-adjustment/start')){external++;assert.equal(r.postDataJSON().confirm,true);return j({operation:{state:'UNKNOWN',operations:[{supplyId:'s',state:'UNKNOWN',error:'Нет подтверждения'}]}});}
  if(path.endsWith('/supply'))return j({connections:[{id:'conn',sellerId:'42'}],directions:p.directions,link:null,differences:[]});
  throw Error('Unexpected '+path);
 });
 await page.goto((process.env.TEST_BASE_URL||'http://127.0.0.1:5198')+'/test/ozon-import-stock.html');
 console.log('Fixture loaded');
 await page.locator('select').first().selectOption('c');
 const link=page.getByRole('region',{name:'Создать сборку по ссылке Ozon'});
 await link.getByLabel('Ссылка на заявку Ozon').fill('https://seller.ozon.ru/app/supply/orders/42');
 await link.getByRole('button',{name:'Получить состав из Ozon'}).click();
 await link.getByRole('region',{name:'Проверка остатков Ozon'}).waitFor();assert.equal(received.items[0].quantity,10);assert.equal(received.warehouseId,'w');assert.equal(creates,0);
 await link.getByRole('button',{name:'Сформировать как есть',exact:true}).click();assert.equal(creates,1);assert.equal(external,0);await link.getByText('Сборка №100 создана.',{exact:true}).waitFor();
 await link.getByRole('button',{name:'Получить состав из Ozon'}).click();await link.getByRole('button',{name:'Скорректировать по фактическим остаткам',exact:true}).click();
 const correction=link.getByRole('region',{name:'Корректировка созданной заявки'});await correction.getByText(/Было 10 шт/).waitFor();assert.equal(creates,2);assert.equal(external,0);
 assert(await correction.getByRole('button',{name:'Применить в WMS и Ozon'}).isDisabled());
 await correction.getByLabel('Подтверждаю изменение количества в заявке WMS и в поставках Ozon').check();await correction.getByRole('button',{name:'Применить в WMS и Ozon'}).click();await correction.getByText('Нет подтверждения',{exact:false}).waitFor();assert.equal(external,1);
 assert.equal(await correction.getByRole('button',{name:'Применить в WMS и Ozon'}).count(),0);assert(await correction.getByRole('button',{name:'Проверить результат / продолжить'}).isVisible());
 // File path uses the same aggregation and requests binding, never silently edits an unrelated Ozon order.
 await page.getByLabel('Место общей отгрузки').fill('Москва');await page.locator('input[type=file]').setInputFiles({name:'plan.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('fixture')});
 await page.getByRole('button',{name:'Проверить файл',exact:true}).click();await page.locator('details').first().getByRole('button',{name:'Скорректировать по фактическим остаткам',exact:true}).click();
 await page.getByText('Привяжите поставку Ozon и сохраните соответствия направлений, чтобы перейти к расчёту уменьшения.',{exact:true}).waitFor();assert.equal(creates,3);assert.equal(external,1);
 failStock=true;await page.getByRole('button',{name:'Проверить файл',exact:true}).click();await page.getByText('Остатки временно недоступны',{exact:true}).waitFor();assert.equal(await page.locator('details').first().getByRole('button',{name:'Сформировать как есть'}).count(),0);
 failStock=false;delayStock=true;await page.getByRole('button',{name:'Проверить файл',exact:true}).click();await page.waitForFunction(()=>document.querySelector('fieldset').disabled);
 // Client selector is locked while checking; a parent scope reset is covered by generation cleanup.
 assert(await page.locator('select').first().isDisabled());releaseStock();await page.getByRole('button',{name:'Сформировать как есть',exact:true}).waitFor();
 await page.locator('select').first().selectOption('other');assert.equal(await page.getByRole('region',{name:'Проверка остатков Ozon'}).count(),0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:8,creates,external,source:'synthetic browser'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

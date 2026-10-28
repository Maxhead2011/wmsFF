const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const fs=require('fs');
const path=require('node:path');
const web=path.resolve(__dirname,'../../apps/web');
const fixtureNames=['fby-validation.html','fby-validation.tsx'];
// TEST: temporary Vite entries are never shipped with the application.
for(const name of fixtureNames)assert(!fs.existsSync(path.join(web,name)),`Temporary fixture already exists: ${name}`);
for(const name of fixtureNames)fs.copyFileSync(path.join(__dirname,'fixtures/yandex-fby',name),path.join(web,name));
process.on('exit',()=>{for(const name of fixtureNames)fs.rmSync(path.join(web,name),{force:true});});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];let created=0,rows=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
 await page.route('**/api/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname;let data=[];
  if(p.endsWith('/clients'))data=[{id:'c',name:'Тестовый клиент'}];
  else if(p.endsWith('/yandex-fby/accounts'))data=[{id:'a',accountName:'Основной',sellerId:'123',client:{name:'Тестовый клиент'}}];
  else if(p.endsWith('/warehouses'))data=[{id:'w',name:'Москва'}];
  else if(p.endsWith('/preview')){const b=req.postDataJSON(),barcode=b.reference?(b.mappings?.[0]?.barcode??''):b.items[0].barcode;data={previewHash:'hash',canCreate:!!barcode,destination:'Москва',desiredDate:null,lines:[{offerId:b.reference?'offer':undefined,barcode,name:'Товар',size:'S',quantity:2,resolved:!!barcode}],availability:barcode?{canCommit:true,lines:[{barcode,availableQuantity:5,reservedQuantity:1,shortageQuantity:0}]}:null};}
  else if(p.endsWith('/requests')&&req.method()==='POST'){const b=req.postDataJSON();assert.equal(b.previewHash,'hash');assert(b.idempotencyKey);created++;const r={id:'r'+created,number:created,title:'Тест FBY',status:'SUBMITTED',warehouseId:'w',destinationCity:'Москва',items:[{quantity:2}],yandexFbyShipment:{remoteNumber:b.reference?'123':null}};rows.push(r);data={request:r,existing:false};}
  else if(p.endsWith('/requests'))data=rows;
  else throw Error('Unexpected API '+p);
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:5189/fby-validation.html');
 const cards=page.locator('.fbo-marketplaces > button');await cards.first().waitFor();assert.equal(await cards.count(),4);
 for(const width of [1440,1920,390]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);const rects=await cards.evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));assert(rects.every(r=>Math.abs(r.w-rects[0].w)<2&&Math.abs(r.h-rects[0].h)<2));}
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:/Яндекс Маркет · FBY/}).click();
 await page.getByLabel(/^Клиент/).selectOption('c');await page.getByLabel(/^Кабинет/).selectOption('a');
 await page.getByRole('button',{name:'Excel / вручную',exact:true}).click();await page.getByLabel('Место отгрузки',{exact:true}).fill('Москва');await page.getByLabel('Товары — ШК; количество').fill('001; 2');
 await page.getByRole('button',{name:'Проверить состав и остатки'}).click();await page.getByRole('button',{name:'Создать сборку',exact:true}).click();await page.getByRole('status').waitFor();assert.equal(created,1);
 await page.getByRole('button',{name:'Из кабинета Яндекса',exact:true}).click();await page.getByLabel('Номер или ссылка на поставку').fill('123');await page.getByRole('button',{name:'Проверить состав и остатки'}).click();
 const mapping=page.getByLabel('ШК offer',{exact:true});await mapping.fill('001');assert.equal(await mapping.inputValue(),'001');assert(await page.getByRole('button',{name:'Создать сборку',exact:true}).isDisabled());
 await page.getByRole('button',{name:'Проверить состав и остатки'}).click();await page.getByRole('button',{name:'Создать сборку',exact:true}).click();await page.getByRole('status').waitFor();assert.equal(created,2);
 await page.getByRole('button',{name:'Отменить сборку',exact:true}).first().click();
 const dialog=page.getByRole('dialog');await dialog.waitFor();assert.equal(await dialog.getAttribute('aria-modal'),'true');await dialog.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);
 await page.setViewportSize({width:390,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
 await page.screenshot({path:'D:/WMSFF/_Kof/work/yandex-fby-mobile.png',fullPage:true});assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:8,created,errors}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

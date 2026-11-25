// TEST: exact relabel component; API is intercepted and no physical print is started.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const dir=path.resolve(process.argv[2]),drafts=JSON.parse(fs.readFileSync(path.join(dir,'drafts.json'))),real=JSON.parse(fs.readFileSync(path.join(dir,'request-3405.json')));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[],writes=[];let submitted=null;
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE',e.message)});page.setDefaultTimeout(15000);
 await page.route('**/*',async route=>{const q=route.request(),p=new URL(q.url()).pathname;
  if(p.startsWith('/api/')){
   if(p.endsWith('/lamoda-relabel/data')){if(q.method()==='POST'){submitted=q.postDataJSON();return route.fulfill({json:{enabled:true,saved:true,locked:false,drafts:drafts.map(d=>({...d,...submitted.labelData.find(i=>i.skuId===d.skuId)}))}})}return route.fulfill({json:{enabled:true,saved:false,locked:false,drafts}});}
   if(p.endsWith('/lamoda-relabel/resolve'))return route.fulfill({json:{id:'unit'}});
   if(p.endsWith('/lamoda-relabel/stations'))return route.fulfill({json:[{id:'station',name:'Test',printerName:'TSC'}]});
   if(q.method()!=='GET')writes.push(p);return route.fulfill({json:p.endsWith('/auth/me')?null:[]});
  }
  if(process.env.CANDIDATE==='1'){const f=path.join(dir,'delta-v2/web',p==='/'?'index.html':p);if(fs.existsSync(f))return route.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'text/javascript':'text/html'});}
  return route.continue();});
 await page.goto('https://wms.logoff.pro/',{waitUntil:'domcontentloaded',timeout:60000});
 await page.evaluate(async input=>{const host=await import('/assets/lamoda-label-host-20261125.js'),mod=await import('/assets/lamoda-relabel-workspace-20261125.js');const div=document.createElement('div');document.body.replaceChildren(div);host.__FbyReactDOM.createRoot(div).render(host.r.createElement(mod.LamodaFboRelabel,{plan:{requestId:input.id,relabelRequired:true,relabelUnits:[{id:'unit',skuId:input.d.skuId,label:{name:input.d.name,size:input.d.size,article:input.d.article,barcode:input.d.barcode},kiz:null,printStatus:null}]},accessToken:'intercepted-only',disabled:false,command:async()=>{throw Error('No packing command expected')},refresh:async()=>{}}));},{id:real.request.id,d:drafts[0]});
 const fields=page.locator('fieldset').filter({hasText:'58 × 40'});await fields.waitFor();
 const save=page.getByRole('button',{name:'Сохранить данные для переклейки',exact:true});assert(await save.isDisabled());
 await page.getByLabel('Складской ШК',{exact:true}).fill('2053414563843');await page.getByRole('button',{name:'Найти соответствие Lamoda',exact:true}).click();
 await page.getByRole('button',{name:'Найти станции печати',exact:true}).click();await page.getByLabel('Станция печати',{exact:true}).selectOption('station');
 const print=page.getByRole('button',{name:'Напечатать 2 этикетки 58 × 40',exact:true});assert(await print.isDisabled());
 await page.getByLabel('Дата производства',{exact:true}).first().fill('25.11.2026');await page.getByRole('checkbox',{name:/Данные состава/}).check();await save.click();
 await page.getByText('Данные переклейки сохранены для этой заявки.',{exact:true}).waitFor();assert.equal(submitted.labelData.length,15);assert.equal(submitted.confirmed,true);assert(submitted.labelData.some(d=>d.manufacturedAt==='25.11.2026'));assert(await print.isEnabled());
 await page.getByLabel('Дата производства',{exact:true}).first().fill('24.11.2026');assert(await print.isDisabled());assert(await save.isDisabled());
 await page.screenshot({path:path.join(dir,'relabel-form.png'),fullPage:true});assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(dir,'browser-proof.json'),JSON.stringify({candidate:process.env.CANDIDATE==='1',request:3405,sku:15,form:'relabel',confirmationRequired:true,editBlocksPrint:true,snapshotSubmitted:true,noPrintStarted:true,noRequestCreation:true,liveWriteRequests:writes,pageErrors:errors},null,2));console.log('PASS exact relabel UI: 15 SKU, four fields, save, print readiness, edits block printing; no print or request creation.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

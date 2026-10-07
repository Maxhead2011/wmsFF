// TEST: real pinned browser graph, fixture-only authentication and API; no production writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/HonorPC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=path.resolve(process.argv[2]),release=path.resolve(process.argv[3]),screens=path.resolve(process.argv[4]);
const user={id:'fixture',name:'Константин',email:'fixture@example.invalid',roleCodes:['OWNER','ADMIN'],permissionCodes:['system:admin','billing:read','billing:write'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:'w',warehouseIds:['w'],writableWarehouseIds:['w']};
const session={accessToken:'fixture-only',tokenType:'Bearer',user};let enabled=true,previewCalls=0,generateCalls=0,lastInput;
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname;let p=name==='/'?release+'/web/index.html':name.startsWith('/assets/')&&fs.existsSync(release+'/web/'+path.basename(name))?release+'/web/'+path.basename(name):base+name;
 if(!p.startsWith(base)&&!p.startsWith(release)){res.writeHead(403).end();return}if(!fs.existsSync(p)){res.writeHead(404).end();return}res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(p));});
(async()=>{await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const url='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(s=>localStorage.setItem('logoff-wms-session',JSON.stringify(s)),session);
 await page.route('**/api/v1/**',async route=>{const p=new URL(route.request().url()).pathname;let data=[];
  if(p.endsWith('/auth/me'))data=user;
  else if(p.endsWith('/branches'))data=[{id:'w',code:'MSK',name:'Москва',warehouseId:'w',isActive:true}];
  else if(p.endsWith('/clients'))data=[{id:'c',code:'CL-TEST',name:'Тестовый клиент',isActive:true}];
  else if(p.endsWith('/done-requests/capabilities'))data={enabled};
  else if(p.endsWith('/period/preview')){previewCalls++;lastInput=route.request().postDataJSON();data={periodFrom:lastInput.periodFrom,periodTo:lastInput.periodTo,previewHash:'a'.repeat(64),alreadyBilledCount:1,zeroCount:0,requests:[{id:'r',number:1244,clientName:'Тестовый клиент',surrenderedAt:'2026-10-01T10:00:00Z'}],groups:[{key:'c:w',clientId:'c',clientName:'Тестовый клиент',warehouseId:'w',category:'OTHER',chargeIds:['ch'],invoiceIds:[],itemCount:1,totalRub:100,action:'CREATE',lines:[{sourceType:'CHARGE',sourceId:'ch',description:'Упаковка',serviceDate:'2026-09-25',quantity:'2',unit:'PIECE',unitPriceRub:'50',totalRub:'100'}]}],issues:[{id:'i',clientName:'Другой клиент',message:'Счёт INV-EXISTING уже сформирован. Период этого клиента исключён. Существующий счёт не изменяется.'}]};}
  else if(p.endsWith('/period/generate')){generateCalls++;const input=route.request().postDataJSON();assert.equal(input.doneRequests,true);assert.equal(input.previewHash,'a'.repeat(64));data={invoices:[{id:'new',number:'INV-NEW',disposition:'CREATED'}],replayed:false};}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(url);await page.getByRole('button',{name:'Биллинг',exact:true}).click();
 const launch=page.getByRole('button',{name:'Создать счёт по сданным заявкам',exact:true});await launch.click();
 const dialog=page.getByRole('dialog',{name:'Единый счёт по сданным заявкам'});await dialog.waitFor();
 assert.equal(await dialog.locator('input[name=periodFrom]').inputValue(),'');assert.equal(await dialog.locator('input[name=periodTo]').inputValue(),'');
 await dialog.getByRole('button',{name:'Предварительный расчёт',exact:true}).click();assert.equal(previewCalls,0);
 await dialog.locator('input[name=periodFrom]').fill('2026-10-01');await dialog.locator('input[name=periodTo]').fill('2026-10-02');
 await dialog.getByRole('button',{name:'Предварительный расчёт',exact:true}).click();await dialog.getByText('№1244',{exact:false}).waitFor();
 assert.equal(lastInput.periodFrom,'2026-10-01');assert.equal(lastInput.periodTo,'2026-10-02');assert.equal(lastInput.doneRequests,true);
 await dialog.getByText('Счёт INV-EXISTING',{exact:false}).waitFor();await dialog.getByRole('button',{name:'Подтвердить создание черновиков',exact:true}).click();await dialog.getByText('INV-NEW',{exact:false}).waitFor();assert.equal(generateCalls,1);
 fs.mkdirSync(screens,{recursive:true});await page.screenshot({path:screens+'/done-requests-desktop.png',fullPage:true});
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();enabled=false;await page.reload();await page.getByRole('button',{name:'Биллинг',exact:true}).click();await page.waitForTimeout(300);assert.equal(await launch.count(),0);
 assert.deepEqual(errors,[]);console.log('PASS actual browser: button, explicit dates, preview sources/existing invoice, single confirmation, disabled flag');
 }finally{await browser.close();await new Promise(ok=>server.close(ok))}})().catch(e=>{console.error(e);server.close();process.exitCode=1});

// TEST: filter the pinned production graph against fixture invoices; never write business data.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/HonorPC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=path.resolve(process.argv[2]),release=path.resolve(process.argv[3]);
const user={id:'fixture',name:'Константин',email:'fixture@example.invalid',roleCodes:['OWNER'],permissionCodes:['system:admin','billing:read','billing:write'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:'w',warehouseIds:['w'],writableWarehouseIds:['w']};
const invoices=['DRAFT','ISSUED','PAID','CANCELLED'].map(status=>({id:status,number:'TEST-'+status,clientId:'c',client:{id:'c',code:'CL-TEST',name:'Тестовый клиент'},status,serviceCategory:'STORAGE',periodFrom:'2026-10-01',periodTo:'2026-10-02',issuedAt:'2026-10-02T10:00:00Z',createdAt:'2026-10-02T10:00:00Z',totalRub:100,paidRub:status==='PAID'?100:0,items:[],payments:[],comment:''}));
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname;const p=name==='/'?release+'/web/index.html':name.startsWith('/assets/')&&fs.existsSync(release+'/web/'+path.basename(name))?release+'/web/'+path.basename(name):base+name;if(!p.startsWith(base)&&!p.startsWith(release)){res.writeHead(403).end();return}if(!fs.existsSync(p)){res.writeHead(404).end();return}res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(p));});
(async()=>{await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(user=>localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'fixture-only',tokenType:'Bearer',user})),user);
 await page.route('**/api/v1/**',async route=>{const req=route.request(),url=new URL(req.url()),p=url.pathname;let data=[];if(req.method()!=='GET')writes.push(p);
  if(p.endsWith('/auth/me'))data=user;
  else if(p.endsWith('/branches'))data=[{id:'w',code:'MSK',name:'Москва',warehouseId:'w',isActive:true}];
  else if(p.endsWith('/clients'))data=[invoices[0].client];
  else if(p.endsWith('/done-requests/capabilities'))data={enabled:true};
  else if(p.endsWith('/billing/invoices'))data=invoices.filter(i=>!url.searchParams.get('status')||i.status===url.searchParams.get('status'));
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('button',{name:'Биллинг',exact:true}).click();
 await page.waitForTimeout(500);assert.deepEqual(errors,[]);
 if(!await page.getByLabel('Статус счёта',{exact:true}).count())throw Error((await page.locator('body').innerText()).slice(-5000));
 const select=()=>page.getByLabel('Статус счёта',{exact:true});
 for(const status of ['DRAFT','ISSUED','PAID','CANCELLED']){
  await select().selectOption(status);await page.getByText('TEST-'+status,{exact:true}).waitFor();
  for(const other of invoices.filter(i=>i.status!==status))assert.equal(await page.getByText(other.number,{exact:true}).count(),0);
 }
 await select().selectOption('');for(const invoice of invoices)await page.getByText(invoice.number,{exact:true}).waitFor();
 await page.getByRole('button',{name:'Темы счетов',exact:true}).click();await select().selectOption('PAID');
 const tile=page.locator('.billing-invoice-kind-tile--all');await page.waitForFunction(()=>document.querySelector('.billing-invoice-kind-tile--all b')?.textContent==='1');
 await tile.click();assert.equal(await select().inputValue(),'PAID');await page.getByText('TEST-PAID',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Создать счёт по сданным заявкам',exact:true}).click();await page.getByRole('dialog',{name:'Единый счёт по сданным заявкам'}).waitFor();
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log('PASS: four statuses, all, topic metrics, retained selection, previous launcher, no writes/errors');
 }finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1});

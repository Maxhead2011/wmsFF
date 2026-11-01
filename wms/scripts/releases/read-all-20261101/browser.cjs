// TEST: count real root bootstraps across initial load, reload and lazy navigation.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(process.argv[2]);
const server=http.createServer((req,res)=>{const rel=new URL(req.url,'http://local').pathname.slice(1)||'index.html';if(rel.includes('..'))return res.end();let p=path.join(root,'web-payload',rel);if(!fs.existsSync(p))p=path.join(root,'web-base',rel);if(!fs.existsSync(p)){res.writeHead(404);return res.end()}let data=fs.readFileSync(p);if(rel.endsWith('.js')){let s=data.toString();s=s.replace(/(\w+)\.createRoot\(document\.getElementById\("root"\)\)/g,(m)=>`((window.__wmsBoots??=[]).push(${JSON.stringify(rel)}),${m})`);data=Buffer.from(s)}res.setHeader('Content-Type',rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':'application/octet-stream');res.end(data)});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage(),errors=[],warnings=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/createRoot|Invalid hook|Minified React|already been passed/.test(m.text()))warnings.push(m.text())});
 const user={id:'fixture',name:'Synthetic',administrationEnabled:true,roleCodes:['OWNER','ADMIN'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:'w',warehouseIds:['w'],writableWarehouseIds:['w']};
 await page.addInitScript(u=>localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'fixture-only',tokenType:'Bearer',user:u})),user);
 let read=false,seenBox=false,seenSession=false;
 const box={createdAt:'2026-10-31T22:25:00Z',id:'boxSignal',clientId:'c',boxCode:'FFL_LKB0909_202',kind:'box',status:'ACTIVE',worker:'Picker',title:'Box absent',detail:'Pallet 149',client:'Fixture'},product={...box,id:'productSignal',kind:'product',title:'Product missing',status:'COMPLETED'};
 await page.route('**/api/v1/**',async route=>{const url=new URL(route.request().url()),p=url.pathname;let data=[];
 if(p.endsWith('/auth/me'))data=user;
 else if(p.endsWith('/warehouse-problems/read-all')){assert.equal(route.request().method(),'POST');assert.deepEqual(route.request().postDataJSON(),{ids:['boxSignal']});read=true;data={readIds:['boxSignal']}}
 else if(p.endsWith('/warehouse-problems'))data=url.searchParams.has('archive')?[{...box,isRead:true},product]:[{...box,isRead:read}];
 else if(p.includes('/turnover/boxes/')){assert(p.endsWith('/FFL_LKB0909_202'));assert.equal(url.searchParams.get('clientId'),'c');seenBox=true;data={box:{code:box.boxCode,client:{id:'c',name:'Fixture'},status:'active'},totals:{rows:0,skuCount:0,kizCount:0,quantity:0},contents:[],movements:[{id:'mov',date:'2026-10-31T07:31:00Z',typeLabel:'Приёмка',quantity:1}]}}
 else if(p.includes('/inventory/dashboard'))data={movementLock:{active:false},activeSessions:[],reviewSessions:[],historySessions:[],pendingRescanRequests:[]};
 else if(p.endsWith('/inventory/sessions/productSignal')){seenSession=true;data={id:'productSignal',title:'Точная проверка короба 117',boxes:[],type:'BOX_CHECK',status:'COMPLETED'}}
 else if(p.endsWith('/users/workspaces'))data={users:[],workspaces:[]};
 else if(p.endsWith('/box-overlaps'))data={errors:[],overlaps:[],requestsWithOverlapsCount:0,overlappingBoxesCount:0};
 else if(p.endsWith('/clients'))data=[{id:'c',name:'Fixture',code:'C',status:'ACTIVE'}];
 else if(p.endsWith('/branches'))data=[{id:'w',name:'Москва',warehouseId:'w',isActive:true}];await route.fulfill({json:data})});
 // TEST: public mode fetches the deployed scripts and only adds a bootstrap counter.
 if(process.env.PUBLIC_URL)await page.route('**/*.js',async route=>{const response=await route.fetch();let body=await response.text();const rel=new URL(route.request().url()).pathname;body=body.replace(/(\w+)\.createRoot\(document\.getElementById\("root"\)\)/g,m=>`((window.__wmsBoots??=[]).push(${JSON.stringify(rel)}),${m})`);await route.fulfill({response,body})});
 await page.goto(process.env.PUBLIC_URL||'http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
 const toast=page.getByRole('alert',{name:'Новая проблема с товаром'});page.setDefaultTimeout(6500);await toast.waitFor();assert.equal(await page.getByRole('dialog',{name:'Проблемы с товаром'}).count(),0);
 await toast.getByText('01.11.2026, 01:25 МСК').waitFor();await page.getByRole('button',{name:'Проблемы с товаром: 1'}).click();await page.getByRole('button',{name:'Прочитать все'}).click();
 const bell=page.getByRole('button',{name:'Проблемы с товаром: 0'});await bell.waitFor();const dlg=page.getByRole('dialog',{name:'Проблемы с товаром'});await dlg.getByText('Непрочитанных проблем нет').waitFor();
 await dlg.getByRole('button',{name:'Архив проблем'}).click();await dlg.getByRole('button',{name:'Открыть товародвижение'}).click();await page.getByText(/Последнее движение товара:.*Приёмка/).waitFor();assert(seenBox);
 await page.getByRole('button',{name:'Закрыть короб'}).click();await bell.click();await dlg.getByRole('button',{name:'Открыть актуализацию'}).click();await page.getByText('Точная проверка короба 117',{exact:true}).first().waitFor();assert(seenSession&&read);assert.deepEqual(errors,[]);
 fs.writeFileSync(root+(process.env.PUBLIC_URL?'/public-browser-proof.json':'/browser-proof.json'),JSON.stringify({passed:6,errors,seenBox,seenSession,read}));console.log('Passed: standalone toast, acknowledgement, archive, scoped box history, last movement, exact session');
}finally{await browser.close();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);server.close();process.exitCode=1});

// TEST: exact public runtime + Lamoda overlay, all API calls intercepted with synthetic fixtures.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),out=root+'/browser';fs.mkdirSync(out,{recursive:true});
const user={id:'lamoda-test',email:'test@example.invalid',name:'Тест',roleCodes:['CLIENT'],permissionCodes:['client-requests:read','client-requests:write','catalog:read','stock:read','marketplace-api:read','marketplace-api:write'],clientScopeMode:'LIMITED',clientIds:['demo','second'],writableClientIds:['demo','second'],warehouseIds:[],writableWarehouseIds:[]};
let accounts=[],writes=[];const errors=[];let passed=0;
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://test').pathname;let file=path.resolve(root+'/web','.'+name);if(!file.startsWith(root+path.sep))return res.end();if(!fs.existsSync(file))file=path.resolve(root+'/web-base','.'+name);if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=root+'/web/index.html';res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({channel:'msedge',headless:true});
try{const context=await browser.newContext({viewport:{width:1440,height:1050}});await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(!url.pathname.startsWith('/api/'))return url.origin===origin?route.continue():route.abort();const p=url.pathname.replace(/^\/api(?:\/v1)?/,'');let data=[];
 if(p==='/auth/me')data=user;
 else if(p==='/clients')data=[{id:'demo',code:'TEST',name:'Учебный клиент'},{id:'second',code:'TEST2',name:'Второй клиент'}];
 else if(p==='/lamoda/accounts'){
  if(req.method()==='POST'){const b=req.postDataJSON();assert.equal(b.secret,'test-secret');assert(!url.href.includes(b.secret));accounts=[{...b,id:'a',isActive:true,checkedAt:null,ordersSyncedAt:null}];delete accounts[0].secret;data=accounts[0];writes.push('account');}else data=accounts.filter(a=>a.clientId===url.searchParams.get('clientId'));
 }else if(p==='/lamoda/accounts/a')data={products:[],documents:[],plans:[],exchanges:[],externalWritesEnabled:false,assemblyEnabled:false,limits:{products:1000,documents:500,plans:100}};
 else if(p==='/lamoda/accounts/a/warehouses')data=[{id:'msk',name:'Москва'}];
 else if(p==='/lamoda/accounts/a/check'){data={message:'Подключение Lamoda проверено.'};writes.push('check');}
 else if(p==='/lamoda/accounts/a/sync'){data={message:'Загрузка завершена: 0 записей.',count:0};writes.push(req.postDataJSON().kind);}
 else if(req.method()!=='GET')throw Error('Unexpected mutation '+p);
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});await context.addInitScript(u=>{localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'isolated-test',tokenType:'Bearer',user:u}));localStorage.setItem('logoff-wms-ui-theme:'+u.id,'modern');},user);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.locator('aside').getByRole('button',{name:'FBO',exact:true}).click();
 await page.getByRole('button',{name:/FBO WB/}).waitFor();await page.getByRole('button',{name:/FBO Ozon/}).waitFor();passed++;
 await page.getByRole('button',{name:/Lamoda Подключение/}).click();const panel=page.locator('.lamoda-workspace');await panel.waitFor();assert((await panel.textContent()).includes('пока недоступны'));passed++;
 await panel.getByLabel(/^Клиент/).selectOption('demo');await panel.getByLabel('Seller ID',{exact:true}).fill('seller');await panel.getByLabel('OAuth Client ID',{exact:true}).fill('oauth');await panel.getByLabel('Client secret',{exact:true}).fill('test-secret');assert.equal(await panel.getByLabel('Client secret',{exact:true}).getAttribute('type'),'password');passed++;
 await panel.getByRole('button',{name:/Сохранить подключение/}).click();await panel.getByLabel('Кабинет Lamoda').selectOption('a');await panel.getByRole('button',{name:/Проверить подключение/}).click();await panel.getByRole('status').filter({hasText:'проверено'}).waitFor();passed++;
 await panel.getByRole('button',{name:'Товары',exact:true}).click();await panel.getByRole('button',{name:/Загрузить каталог/}).click();await panel.getByRole('status').filter({hasText:'Загрузка завершена'}).waitFor();passed++;
 await panel.getByRole('button',{name:'Планы FBO',exact:true}).click();await panel.getByRole('button',{name:'Скачать шаблон',exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Сохранить черновик',exact:true}).isDisabled(),true);passed++;
 await panel.getByRole('button',{name:'Заказы FBS',exact:true}).click();assert.equal(await panel.getByRole('button',{name:'Загрузить заказы',exact:true}).isDisabled(),true);passed++;
 await panel.getByRole('button',{name:'Подключение',exact:true}).click();await panel.getByLabel(/^Клиент/).selectOption('second');assert.equal(await panel.getByLabel('Client secret',{exact:true}).inputValue(),'');assert.equal(await panel.getByLabel('Seller ID',{exact:true}).inputValue(),'');passed++;
 await panel.screenshot({path:out+'/lamoda.png'});assert.deepEqual(errors,[]);assert.deepEqual(writes,['account','check','CATALOG']);passed++;
 // Revisit old workspaces: their dynamic imports still resolve through the original import map.
 await page.getByRole('button',{name:/FBO WB/}).click();await page.screenshot({path:out+'/wb.png'});fs.writeFileSync(out+'/wb.html',await page.content());await page.locator('.client-requests-panel').waitFor();passed++;
 fs.writeFileSync(out+'/proof.json',JSON.stringify({passed,isolatedApi:true,writes,errors}));console.log(JSON.stringify({passed,isolatedApi:true}));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1});

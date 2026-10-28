// TEST: actual production printing component, mocked network; never sends a physical print.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),base=path.resolve(process.argv[3]);
const user={id:'print-test',email:'test@example.invalid',name:'Тест',roleCodes:['OWNER'],permissionCodes:['system:admin','print:write','skus:read'],clientScopeMode:'LIMITED',clientIds:['c','other'],writableClientIds:['c','other'],warehouseIds:[],writableWarehouseIds:[]};
const jobs=[],searches=[],errors=[];let passed=0;
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://test').pathname.replace(/^\/$/,'/index.html');let file=path.resolve(root+'/web','.'+name);if(!file.startsWith(root+path.sep))return res.end();if(process.env.BEFORE_FIX||!fs.existsSync(file))file=path.resolve(base,'.'+name);if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=base+'/index.html';res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=process.env.WEB_ORIGIN||'http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({channel:'msedge',headless:true});let page;
try{const context=await browser.newContext({viewport:{width:1440,height:1050}});await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url());if(!url.pathname.startsWith('/api/'))return url.origin===origin?route.continue():route.abort();const p=url.pathname.replace(/^\/api(?:\/v1)?/,'');let data=[];
 if(p==='/auth/me')data=user;
 else if(p==='/clients')data=['c','other'].map(id=>({id,status:'ACTIVE',clientKind:'LEGAL_ENTITY',code:id,name:id==='c'?'ИП Лукин Илья Ильич':'Другой клиент'}));
 else if(p==='/skus'){
  searches.push(url.search);const print=url.searchParams.get('forPrint')==='true';
  data=print?[{id:'s',clientId:'c',internalSku:'WAREHOUSE',name:'Костюм вязаный',article:'Складской артикул',size:'48',color:'Бежевый',barcodes:[{id:'b',value:'2052174487703',isPrimary:true},{id:'l',value:'04640684262439',isPrimary:false,source:'LAMODA'}]}]:[];
 }else if(p==='/print/agent-stations')data=[{id:'station',name:'Тест',printerName:'Тестовый принтер',lastSeenAt:new Date().toISOString()}];
 else if(p==='/print/agent-jobs'&&req.method()==='POST'){jobs.push(req.postDataJSON());data={id:'job',status:'queued'};}
 else if(req.method()!=='GET')throw Error('Unexpected write '+p);
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});await context.addInitScript(u=>{localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'isolated-test',tokenType:'Bearer',user:u}));localStorage.setItem('logoff-wms-ui-theme:'+u.id,'modern');},user);
page=await context.newPage();const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');cdp.on('Network.requestWillBeSent',e=>{if(e.request.url.includes('/skus?'))console.log(JSON.stringify({lookupFrames:e.initiator.stack?.callFrames}));});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin,{waitUntil:'domcontentloaded'});
await page.locator('aside').getByRole('button',{name:'Печать',exact:true}).click();await page.getByRole('button',{name:/^Печать SKU/}).click();
const panel=page.getByRole('region',{name:'Печать ШК товара'});
await panel.getByPlaceholder('Часть ШК, артикула или названия').fill('Вязка_кашемир_бежевый_48');await panel.getByRole('button',{name:'Найти',exact:true}).click();
const barcode=panel.getByRole('combobox',{name:'Штрихкод товара Костюм вязаный'});await barcode.waitFor();
assert.equal(await barcode.inputValue(),'2052174487703');assert.match(await barcode.textContent(),/04640684262439 · Lamoda/);passed++;
await barcode.selectOption('04640684262439');await panel.getByRole('checkbox').check();
const selects=panel.locator('select');await selects.last().selectOption('AGENT:station');
await panel.getByRole('button',{name:'Напечатать 1 товаров',exact:true}).click();await panel.getByText('В очередь отправлено 1 товаров, всего 1 этикеток.').waitFor();
assert.equal(jobs.length,1);assert.equal(jobs[0].barcode,'04640684262439');assert.equal(jobs[0].skuId,'s');assert(jobs[0].imageBase64.startsWith('iVBOR'));passed++;
await panel.getByRole('combobox',{name:'Клиент',exact:true}).selectOption('other');assert.equal(await panel.getByRole('checkbox').count(),0);assert(await panel.getByRole('button',{name:'Напечатать 0 товаров',exact:true}).isDisabled());passed++;
assert.deepEqual(errors,[]);const webHashes={};for(const n of ['index.html','assets/lamoda-print-host-20261028.js']){
 const bytes=process.env.WEB_ORIGIN?Buffer.from(await (await context.request.get(origin+'/'+n)).body()):fs.readFileSync(root+'/web/'+n);
 webHashes[n]=require('crypto').createHash('sha256').update(bytes).digest('hex');
}fs.writeFileSync(root+(process.env.WEB_ORIGIN?'/public-browser-proof.json':'/browser-proof.json'),JSON.stringify({passed,searches,jobs:jobs.map(({imageBase64,...rest})=>rest),errors,syntheticApi:true,webHashes}));console.log(JSON.stringify({passed,syntheticApi:true}));
}catch(e){console.error(JSON.stringify({searches,errors}));if(page)await page.screenshot({path:root+'/browser-failure.png',fullPage:true});throw e;}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1});

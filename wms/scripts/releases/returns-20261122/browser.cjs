const fs=require('fs'),path=require('path'),assert=require('assert');
const {chromium}=require('D:/WMSFF/_Kof/work/node_modules/playwright');
const work=process.argv[2];
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
const page=await browser.newPage({viewport:{width:1400,height:950}}),errors=[],calls=[];
page.on('pageerror',e=>errors.push(e.message));
const user={id:'returns-test',name:'Проверка возвратов',email:'test@example.invalid',roleCodes:['OWNER','ADMIN'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:'w',warehouseIds:['w'],writableWarehouseIds:['w']};
await page.addInitScript(user=>{localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'synthetic',user}));localStorage.setItem('logoff-wms-ui-theme:'+user.id,'modern');},user);
let batch=null;
await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()),p=u.pathname;
if(p.startsWith('/api/')){calls.push([req.method(),p]);let body=[];
if(p.endsWith('/auth/me'))body=user;else if(p.endsWith('/branches'))body=[{id:'w',name:'Москва',isActive:true}];else if(p.endsWith('/clients'))body=[{id:'c',name:'Клиент возвратов',code:'CL-TEST'}];
else if(p==='/api/v1/returns'&&req.method()==='POST'){batch={...req.postDataJSON(),status:'SORTING',createdAt:new Date().toISOString(),createdByName:user.name,units:[]};body=batch;}
else if(p==='/api/v1/returns')body=batch?[batch]:[];
else if(p.endsWith('/scan')){batch.units.push({...req.postDataJSON(),productName:'Костюм XL',scannedByName:user.name});body=batch.units.at(-1);}
else if(p.endsWith('/finish')){batch.status='STORED';body=batch;}
else if(req.method()!=='GET')throw Error('Unexpected write '+p);
return route.fulfill({json:body});}
const local=path.join(work,'web',p==='/'?'index.html':p);if(!process.env.RETURNS_PUBLIC && fs.existsSync(local))return route.fulfill({body:fs.readFileSync(local),contentType:local.endsWith('.js')?'text/javascript':local.endsWith('.css')?'text/css':'text/html'});
return route.continue();});
await page.goto('https://wms.logoff.pro/',{waitUntil:'networkidle'});
await page.getByRole('button',{name:'Возвраты',exact:true}).first().click();
await page.waitForTimeout(1500);fs.writeFileSync(path.join(work,'browser-body.txt'),await page.locator('body').innerText());fs.writeFileSync(path.join(work,'browser-errors.json'),JSON.stringify(errors));await page.screenshot({path:path.join(work,'browser-before.png')});await page.getByRole('combobox').filter({has:page.locator('option[value="c"]')}).selectOption('c');
await page.getByRole('button',{name:'Начать сортировку'}).click();
await page.getByLabel('Код возврата',{exact:true}).fill('WB-return-1');await page.getByLabel('ШК фактического товара').fill('0461234567890');await page.getByLabel('Короб',{exact:true}).fill('RETURN_BOX_01');
await page.getByRole('button',{name:'Сохранить возврат'}).click();await page.getByText('Костюм XL').waitFor();
await page.getByRole('button',{name:'Завершить сортировку'}).click();await page.getByRole('button',{name:/На хранении/}).waitFor();
assert.equal(batch.units.length,1);assert.equal(batch.status,'STORED');assert.deepEqual(errors,[]);
await page.screenshot({path:path.join(work,'returns-desktop.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(work,'returns-mobile.png'),fullPage:true});
fs.writeFileSync(path.join(work,'browser-proof.json'),JSON.stringify({synthetic:true,errors,calls,units:batch.units.length,status:batch.status},null,2));console.log('Browser flow passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

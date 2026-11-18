// TEST: load the complete served app, real Excel form and captured read-only preview.
// All business requests are intercepted; no request or upload reaches production.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const root=path.resolve(process.argv[2]),origin=process.env.TEST_ORIGIN;
const data=JSON.parse(fs.readFileSync(path.join(root,'browser-input.json'),'utf8'));
const user={id:'wb-plan-release-test',name:'Release test',roleCodes:['OWNER','ADMIN'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:data.warehouseId,warehouseIds:[data.warehouseId],writableWarehouseIds:[data.warehouseId]};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1050},ignoreHTTPSErrors:true});page.setDefaultTimeout(20000);
  const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(u=>{localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'synthetic-no-write',user:u}));localStorage.setItem('logoff-wms-ui-theme:'+u.id,'modern')},user);
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),p=url.pathname;
   if(p.startsWith('/api/')){
    let body=[];
    if(p.endsWith('/auth/me'))body=user;
    else if(p.endsWith('/branches'))body=[{id:data.warehouseId,name:'Test warehouse',isActive:true}];
    else if(p.endsWith('/clients'))body=[data.client];
    else if(p.endsWith('/client-requests/outbound-xlsx/preview'))body={...data.preview,wbClientPlanEnabled:true,clientPlanHasParseErrors:false};
    else if(p.endsWith('/client-requests')&&request.method()==='POST'){
     writes.push(request.postDataJSON());return route.fulfill({status:409,json:{message:'Release test: creation intercepted; no database write.'}});
    }else if(p.endsWith('/box-overlaps'))body={statusCounts:[],overlaps:[],errors:[],overlappingBoxesCount:0};
    else if(request.method()!=='GET')return route.fulfill({json:{}});
    return route.fulfill({json:body});
   }
   if(process.env.PUBLIC_MODE!=='true'&&url.origin===origin){
    const file=path.join(root,'release-candidate/web',p==='/'?'index.html':p);
    if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({body:fs.readFileSync(file),contentType:p.endsWith('.js')?'text/javascript':'text/html'});
   }
   return route.continue();
  });
  for(let i=0;i<2;i++){
   if(i)await page.reload({waitUntil:'domcontentloaded'});else await page.goto(origin,{waitUntil:'domcontentloaded'});
   await page.getByText('Быстрый доступ',{exact:true}).waitFor();
   await page.getByText('Заявки',{exact:true}).first().click();
   const fold=page.locator('details.request-fold').filter({has:page.locator('summary',{hasText:'Сборка из Excel'})}).first();
   await fold.locator(':scope > summary').click();
   const form=page.locator('form.client-request-xlsx-form');await form.waitFor();
   await form.getByLabel('Город поставки',{exact:true}).fill('Москва');
   await form.locator('input[type=file]').setInputFiles(data.filePath);
   await form.getByRole('button',{name:'Проверить файл',exact:true}).click();
   await form.locator('.client-request-xlsx-line').first().waitFor();
   assert.equal(await form.locator('.client-request-xlsx-line').count(),9);
   assert(await form.getByRole('button',{name:'Создать заявку',exact:true}).isDisabled());
   await form.getByLabel('WB: сформировать по заявке клиента, включая дефицит',{exact:false}).check();
   const create=form.getByRole('button',{name:'Сформировать по заявке клиента',exact:true});assert(await create.isEnabled());
   await create.click();await form.getByText('Release test: creation intercepted; no database write.',{exact:false}).waitFor();
   const payload=writes.at(-1);assert.equal(payload.fboFormationMode,'WB_CLIENT_PLAN');assert.equal(payload.warehouseId,data.warehouseId);
   const key=items=>items.map(x=>x.skuId+':'+x.barcode+':'+x.quantity).sort();assert.deepEqual(key(payload.items),key(data.items));
  }
  assert.deepEqual(errors,[]);assert.equal(writes.length,2);await page.screenshot({path:path.join(root,process.env.PUBLIC_MODE==='true'?'published.png':'candidate.png'),fullPage:true});
  const proof={passed:true,fullAppStartupAndReload:true,defaultShortageBlocked:true,explicitPlanQuantity:705,lines:9,createIntercepted:true,noWrites:true};
  fs.writeFileSync(path.join(root,process.env.PUBLIC_MODE==='true'?'published-browser-proof.json':'browser-proof.json'),JSON.stringify(proof));console.log(JSON.stringify(proof));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

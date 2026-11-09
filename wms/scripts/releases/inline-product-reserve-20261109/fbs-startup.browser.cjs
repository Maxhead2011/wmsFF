// TEST: import the actual deployed FBS graph, including its reserve editor and shared React.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const user={id:'startup-test',name:'Test',email:'test@example.invalid',activeWarehouseId:null,roleCodes:['OWNER'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[]};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage(),errors=[];
  await page.addInitScript(user=>localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'synthetic-no-access',user})),user);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',r=>r.fulfill({json:new URL(r.request().url()).pathname.endsWith('/auth/me')?user:[]}));
  if(process.env.CANDIDATE_ROOT)await page.route(process.env.PUBLIC_URL,r=>r.fulfill({body:fs.readFileSync(process.env.CANDIDATE_ROOT+'/web-payload/index.html'),contentType:'text/html'}));
  if(process.env.CANDIDATE_ROOT)await page.route('**/assets/**',r=>{
   const name=new URL(r.request().url()).pathname,file=process.env.CANDIDATE_ROOT+'/web-payload'+name;
   return fs.existsSync(file)?r.fulfill({body:fs.readFileSync(file),contentType:name.endsWith('.css')?'text/css':'text/javascript'}):r.continue();
  });
  for(let reload=0;reload<2;reload++){
   if(reload)await page.reload();else await page.goto(process.env.PUBLIC_URL);
   const result=await page.evaluate(async()=>{
    try {
     const map=JSON.parse(document.querySelector('script[type="importmap"]').textContent).imports;
     await import(map['/assets/wb-document-actions-20261108.js']);
     return 'loaded';
    }catch(error){return error.stack}
   });
   assert.equal(result,'loaded','Actual FBS module must load with the published React singleton');
   await page.getByText('Быстрый доступ',{exact:true}).waitFor(); await page.getByText('FBS',{exact:true}).first().click({timeout:5000});
   await page.getByText('Выберите маркетплейс',{exact:true}).waitFor();
   assert.deepEqual(errors,[]);
  }
  console.log('PASS: actual published FBS graph imports on startup and reload');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

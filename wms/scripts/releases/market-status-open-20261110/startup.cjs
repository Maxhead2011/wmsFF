// TEST: run actual production modules, not extracted handlers. API responses are mocked.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const fixEntry=html=>{const map=JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]);assert.equal(html.match(/<script type="module" crossorigin src="([^"]+)"/)[1],map.imports['/assets/admin-tiles-20261019-0.js']);return html;};
const url=process.env.PUBLIC_URL;
const user={id:'startup-regression',name:'Startup test',email:'startup@example.invalid',roleCodes:['OWNER'],permissionCodes:[],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:null};
(async()=>{
 const b=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
 try{
  const p=await b.newPage(),errors=[];let restores=0;
  p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(u=>localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'synthetic-no-access',user:u})),user);
  if(process.env.UI_THEME)await p.addInitScript(theme=>localStorage.setItem('logoff-wms-ui-theme:startup-regression',theme),process.env.UI_THEME);
  await p.route('**/api/**',r=>{const me=new URL(r.request().url()).pathname.endsWith('/auth/me');if(me)restores++;return r.fulfill({json:me?user:[]})});
  if(process.env.CANDIDATE_ROOT)await p.route('**/assets/**',async route=>{const file=process.env.CANDIDATE_ROOT+new URL(route.request().url()).pathname;if(fs.existsSync(file))return route.fulfill({body:fs.readFileSync(file),contentType:'text/javascript'});return route.continue();});
  if(process.env.CANDIDATE_HTML)await p.route(url,async r=>r.fulfill({body:fixEntry(fs.readFileSync(process.env.CANDIDATE_HTML,'utf8')),contentType:'text/html'}));
  for(let i=0;i<2;i++){
   if(i)await p.reload({waitUntil:'domcontentloaded'});else await p.goto(url,{waitUntil:'domcontentloaded'});
   await p.getByText('Быстрый доступ',{exact:true}).waitFor();
   await p.waitForTimeout(1000);
   assert.deepEqual(errors,[], 'Full application must start without DOM/React exceptions');
   const entries=await p.evaluate(()=>{
    const map=JSON.parse(document.querySelector('script[type="importmap"]').textContent).imports;
    const entry=document.querySelector('script[type="module"][crossorigin]').getAttribute('src');
    const expected=map['/assets/admin-tiles-20261019-0.js'];
    if(entry!==expected)throw Error('Entry URL differs from shared root import');
    const roots=new Set([entry,'/assets/stock-export-20261106.js','/assets/wb-all-labels-api-20261108.js']);
    return performance.getEntriesByType('resource').filter(x=>roots.has(new URL(x.name).pathname)).map(x=>x.name);
   });
   assert.equal(entries.length,1,'Only one root module must be loaded');
  }
  assert.equal(restores,2,'Exactly one session restore per load');
  console.log('PASS: full application startup + reload; one entry and session restore per load');
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

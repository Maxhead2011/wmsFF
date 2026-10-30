// TEST: full actual application entry and navigation, synthetic APIs only.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),publicMode=process.argv.includes('--public'),origin='https://wms.logoff.pro';
const user={id:'sidebar-test',email:'sidebar@example.invalid',name:'Test',roleCodes:['OWNER'],permissionCodes:['system:admin','client-requests:read','stock:read'],clientScopeMode:'ALL',clientIds:[],warehouseIds:[],activeWarehouseId:'msk'};
let value={requests:{total:230,inWork:11},fbs:{total:205,inWork:9},fbo:{total:25,inWork:2}},failed=false,reads=0,passed=0;const errors=[];
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
for(const theme of ['la_panthera','modern']){
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(({user,theme})=>{localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'synthetic',tokenType:'Bearer',user}));localStorage.setItem('logoff-wms-ui-theme:'+user.id,theme);},{user,theme});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url()),p=u.pathname;
  if(p.startsWith('/api/')){
   let data=[];
   if(p.endsWith('/navigation-counts')){reads++;if(failed)return route.fulfill({status:500,contentType:'application/json',body:'{}'});data=value;}
   else if(p.endsWith('/auth/me'))data=user;
   else if(p.endsWith('/panthera-favorites'))data={ids:['requests','fbs','fbo-ozon','kiz'],revision:1};
   else if(p.includes('/kiz/issues'))data={items:[],summary:{unread:6,total:6}};
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  }
  if(u.origin!==origin)return route.abort();
  if(!publicMode){const f=path.join(root,'web/payload',p==='/'?'index.html':p.slice(1));if(fs.existsSync(f))return route.fulfill({contentType:p.endsWith('.js')?'text/javascript':'text/html',body:fs.readFileSync(f)});}
  return route.continue();
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 const nav=page.locator('nav.workspace-nav');await nav.locator('.workspace-nav__badge').filter({hasText:'230 (11)'}).first().waitFor();
 for(const text of ['230 (11)','205 (9)','25 (2)'])assert(await nav.getByText(text,{exact:true}).count()>=1);passed++;
 if(theme==='la_panthera'){for(const text of ['230 (11)','205 (9)','25 (2)'])assert.equal(await nav.locator('.workspace-favorites').getByText(text,{exact:true}).count(),1);passed++;}
 value={requests:{total:0,inWork:0},fbs:{total:0,inWork:0},fbo:{total:0,inWork:0}};await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await nav.getByText('0 (0)',{exact:true}).first().waitFor();passed++;
 failed=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await nav.getByText('—',{exact:true}).first().waitFor();assert.equal(await nav.getByText('0 (0)',{exact:true}).count(),0);passed++;
 failed=false;value={requests:{total:230,inWork:11},fbs:{total:205,inWork:9},fbo:{total:25,inWork:2}};await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await nav.getByText('25 (2)',{exact:true}).first().waitFor();passed++;
 await page.screenshot({path:path.join(root,(publicMode?'public-':'')+theme+'.png')});await context.close();
}
assert.deepEqual(errors,[]);const proof={passed,reads,errors,syntheticOnly:true,publicMode};fs.writeFileSync(path.join(root,publicMode?'public-browser-proof.json':'browser-proof.json'),JSON.stringify(proof));console.log(proof);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

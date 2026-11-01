// TEST: open the deployed Requests row, then verify binding reads its FBO request ID.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(process.argv[2]);
const publicMode = process.argv.includes('--public');
const red = process.argv.includes('--before');
const origin = 'https://wms.logoff.pro';
const cache = path.join(root, publicMode?'published-assets':'browser-assets');
async function read(name) {
  const choices = publicMode ? [cache] : [...(red?[]:[path.join(root,'web/payload')]),path.join(root,'web-base'),cache];
  for(const dir of choices) if(fs.existsSync(path.join(dir,name))) return fs.readFileSync(path.join(dir,name));
  const res = await fetch(origin+'/'+name+'?request-controls-test=1'); assert(res.ok,name);
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(path.join(cache,name)),{recursive:true}); fs.writeFileSync(path.join(cache,name),bytes);
  return bytes;
}
(async()=>{
 const html=(await read('index.html')).toString(), map=JSON.parse(html.match(/type="importmap">(.*?)<\/script>/s)[1]);
 const assets=map.imports, core=assets['/assets/admin-tiles-20261019-0.js'], list=assets['/assets/admin-tiles-20261019-4.js'], host=assets['/assets/admin-tiles-20261019-15.js'];
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const errors=[],writes=[];
 const clients=['Яковлев','Антонова'].map((name,i)=>({id:'client'+i,name,code:'CL-0'+i}));
 const plan=JSON.parse(fs.readFileSync(path.join(root,'plan.json'),'utf8'));
 const requests=clients.map((client,i)=>({id:'r'+i,number:2564+i,type:'OUTBOUND',status:'IN_WORK',priority:'NORMAL',title:'Сборка из Excel',clientId:client.id,client,items:[{id:'i'+i,quantity:1,requestedName:'Товар'}],packages:[],files:[],createdAt:'2026-10-30T10:00:00Z',updatedAt:'2026-10-30T10:00:00Z',_count:{fbsOrderLinks:0}}));
 Object.assign(requests[0],{id:plan.requestId,number:2565,title:plan.title,status:'PACKED'});requests.splice(1);
 let reads=0;
 try {
 const page=await browser.newPage({viewport:{width:1550,height:900}});page.setDefaultTimeout(6500);
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()), n=url.pathname;
  if(url.origin!==origin)return route.abort();
  if(n.includes('/api/')){
    if(route.request().method()!=='GET')writes.push(n);
    let data=[];
    if(n.endsWith('/tsd/requests/'+plan.requestId))data={fbo:plan};
    if(n.includes('/wb-fbo-supply')){assert(n.includes('/'+plan.requestId+'/'));reads++;}
    if(n.endsWith('/client-requests'))data=requests;
    if(n.endsWith('/clients'))data=clients;
    if(n.includes('/wb-fbo-supply'))data={binding:null,plannedQuantity:1290,canWrite:true,canGate:false,connections:[{id:'wb',accountName:'Тестовый кабинет'}]};
    return route.fulfill({status:n.endsWith('/auth/me')?401:200,contentType:'application/json',body:JSON.stringify(data)});
  }
  if(n==='/fixture')return route.fulfill({contentType:'text/html',body:'<html data-ui-theme="modern" data-ui-variant="la_panthera"><head><script type="importmap">'+JSON.stringify(map)+'</script>'+ (html.match(/<link[^>]*rel="stylesheet"[^>]*>/g)||[]).join('')+'</head><body><div id="root" hidden></div><main id="fixture" class="workspace-content"></main></body></html>'});
  let bytes=await read(n.slice(1));
  if(n===core){const s=bytes.toString(),a=s.match(/([\w$]+)\.createRoot\(document\.getElementById\("root"\)\)/)[1];bytes=Buffer.from(s+'\nexport {'+a+' as proofDOM};');}
  if(n===list)bytes=Buffer.concat([bytes,Buffer.from('\nexport {xr as proofList};')]);
  return route.fulfill({contentType:n.endsWith('.js')?'text/javascript':n.endsWith('.css')?'text/css':'application/octet-stream',body:bytes});
 });
 await page.goto(origin+'/fixture');
 await page.evaluate(async()=>{
  const c=await import('/assets/admin-tiles-20261019-0.js');
  const list=await import('/assets/admin-tiles-20261019-4.js');
  const root=c.proofDOM.createRoot(document.getElementById('fixture')), R=c.r;
  root.render(R.createElement(list.proofList,{session:{accessToken:'fixture',user:{id:'fixture',name:'Тест',roleCodes:[],permissionCodes:['client-requests:read','client-requests:write','client-requests:status','stock:write'],clientScopeMode:'ALL',writableClientIds:['client0','client1'],activeWarehouseId:null}}}));
 });
 const row=page.locator('.client-request-row').first();await row.waitFor({state:'attached'});
 const open=row.locator('[title="Онлайн-выполнение заявки"],[title="Открыть сборку"]').first();
 const menus=open.locator('xpath=ancestor::details');for(const menu of await menus.all())if(!await menu.evaluate(el=>el.open))await menu.locator(':scope > summary').click();
 await open.click();
 const header=page.locator('header').filter({has:page.getByRole('heading',{name:/FBO WB.*002565/})});await header.waitFor();
 const button=header.getByRole('button',{name:'Заявка ВБ',exact:true});await button.click();
 const dialog=page.locator('dialog[open]');await dialog.getByLabel('Ссылка или номер поставки WB').waitFor();
 assert.equal(reads,1);assert.equal(writes.filter(n=>!n.includes('/auth/')).length,0);
 await dialog.getByRole('button',{name:'Закрыть окно'}).click();await header.waitFor();await header.screenshot({path:path.join(root,publicMode?'published-header.png':'header.png')});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,publicMode?'public-proof.json':'browser-proof.json'),JSON.stringify({request:2565,openFromList:true,bindingRequestId:plan.requestId}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

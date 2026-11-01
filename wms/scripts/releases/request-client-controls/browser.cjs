// TEST: exercise both live FBO panels and the request list, with fixture data only.
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
 const requests=clients.map((client,i)=>({id:'r'+i,number:2564+i,type:'OUTBOUND',status:'IN_WORK',priority:'NORMAL',title:'Сборка из Excel',clientId:client.id,client,items:[{id:'i'+i,quantity:1,requestedName:'Товар'}],packages:[],files:[],createdAt:'2026-10-30T10:00:00Z',updatedAt:'2026-10-30T10:00:00Z',_count:{fbsOrderLinks:0}}));
 try {
 const page=await browser.newPage({viewport:{width:1550,height:900}});page.setDefaultTimeout(6500);
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()), n=url.pathname;
  if(url.origin!==origin)return route.abort();
  if(n.includes('/api/')){
    if(route.request().method()!=='GET')writes.push(n);
    let data=[];
    if(n.endsWith('/client-requests'))data=requests;
    if(n.endsWith('/clients'))data=clients;
    if(n.includes('/wb-fbo-supply'))data={binding:null,plannedQuantity:1290,canWrite:true,canGate:false,connections:[{id:'wb',accountName:'Тестовый кабинет'}]};
    return route.fulfill({status:n.endsWith('/auth/me')?401:200,contentType:'application/json',body:JSON.stringify(data)});
  }
  if(n==='/fixture')return route.fulfill({contentType:'text/html',body:'<html data-ui-theme="modern" data-ui-variant="la_panthera"><head><script type="importmap">'+JSON.stringify(map)+'</script>'+ (html.match(/<link[^>]*rel="stylesheet"[^>]*>/g)||[]).join('')+'</head><body><div id="root" hidden></div><main id="fixture" class="workspace-content"></main></body></html>'});
  let bytes=await read(n.slice(1));
  if(n===core){const s=bytes.toString(),a=s.match(/([\w$]+)\.createRoot\(document\.getElementById\("root"\)\)/)[1];bytes=Buffer.from(s+'\nexport {'+a+' as proofDOM};');}
  if(n===list)bytes=Buffer.concat([bytes,Buffer.from('\nexport {xr as proofList};export const proofPanel=__OnlinePanel.FboTwoStagePanel;')]);
  if(n===host)bytes=Buffer.concat([bytes,Buffer.from('\nexport {Jr as proofPanel};')]);
  return route.fulfill({contentType:n.endsWith('.js')?'text/javascript':n.endsWith('.css')?'text/css':'application/octet-stream',body:bytes});
 });
 await page.goto(origin+'/fixture');
 await page.evaluate(async()=>{
  const c=await import('/assets/admin-tiles-20261019-0.js');
  const list=await import('/assets/admin-tiles-20261019-4.js'),host=await import('/assets/admin-tiles-20261019-15.js');
  const root=c.proofDOM.createRoot(document.getElementById('fixture')), R=c.r;
  window.show=(entry,marketplace='WILDBERRIES')=>root.render(entry==='list'?R.createElement(list.proofList,{session:{accessToken:'fixture',user:{id:'fixture',name:'Тест',roleCodes:[],permissionCodes:['client-requests:read','client-requests:write','client-requests:status'],clientScopeMode:'ALL',writableClientIds:['client0','client1'],activeWarehouseId:null}}}):R.createElement((entry==='host'?host:list).proofPanel,{key:entry+marketplace,initial:{requestId:'fixture',number:2564,title:'Сборка из Excel 30.10.2026',marketplace,phase:'PACKING',needed:1290,picked:1290,packed:1245,looseRemaining:45,shortage:0,wholeBoxes:[],lines:[],route:[],boxes:[]},accessToken:'fixture',userId:'fixture',canWrite:true,onClose:()=>{}}));
  window.show('host');
 });
 const bind=page.getByRole('button',{name:'Поставка ВБ',exact:true});
 for(const entry of ['host','listPanel']){
  await page.evaluate(e=>window.show(e),entry);
  await bind.click(); await page.getByLabel('Ссылка или номер поставки WB').waitFor();
  await page.getByRole('button',{name:'Закрыть окно'}).click();
 }
 await page.evaluate(()=>window.show('host','OZON')); await page.getByRole('heading',{name:/FBO Ozon/}).waitFor();assert.equal(await bind.count(),0);
 await page.evaluate(()=>window.show('host'));await bind.waitFor();
 const header=await page.locator('#fixture .online-execution-modal__header').first().screenshot();
 await page.evaluate(()=>window.show('list'));const sort=page.getByRole('combobox',{name:'Поле сортировки'});
 await sort.selectOption('client');const direction=page.getByRole('combobox',{name:'Направление сортировки'});
 await direction.selectOption('asc');const rows=page.locator('.client-request-row');await rows.first().getByText(/Антонова/).first().waitFor({state:"attached"});
 await direction.selectOption('desc');await rows.first().getByText(/Яковлев/).first().waitFor({state:"attached"});
 await direction.selectOption('asc');
 const batch=page.getByRole('button',{name:'Проверить статусы всех заявок'});assert.equal(await batch.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(23, 84, 173)');
 const sortbar=await page.locator('.client-request-sortbar').screenshot(),toolbar=await batch.locator('..').screenshot();
 await page.setContent('<main style="font:20px Segoe UI;background:#f2f6f8;padding:28px;color:#233c49"><h2>Заявки</h2><div id="list"></div><h2>Онлайн-выполнение · привязка поставки</h2><div id="window"></div></main>');
 for(const [id,bytes] of [['list',sortbar],['list',toolbar],['window',header]])await page.locator('#'+id).evaluate((el,b64)=>{const i=new Image();i.src='data:image/png;base64,'+b64;i.style.cssText='display:block;max-width:100%;margin-bottom:10px';el.append(i);},bytes.toString('base64'));
 await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
 await page.locator('main').screenshot({path:path.join(root,'Макет-заявок.png')});
 assert.deepEqual(errors,[]);assert.equal(writes.filter(n=>!n.includes('/auth/')).length,0);
 fs.writeFileSync(path.join(root,publicMode?'public-proof.json':'browser-proof.json'),JSON.stringify({bothWbWindows:true,ozonExcluded:true,sortBothDirections:true,buttonColor:true}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

// TEST: exercise the captured production graph with synthetic API responses.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),publicMode=process.argv.includes('--public');
const origin='https://wms.logoff.pro';
async function bytes(name){
  if(!publicMode){const local=path.join(root,'payload/web',name);if(fs.existsSync(local))return fs.readFileSync(local);}
  const cache=path.join(root,publicMode?'public-cache':'browser-cache',name);
  if(fs.existsSync(cache))return fs.readFileSync(cache);
  const response=await fetch(origin+'/'+name);assert(response.ok,name);
  const body=Buffer.from(await response.arrayBuffer());fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,body);return body;
}
(async()=>{
 const html=(await bytes('index.html')).toString(),map=JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]);
 const core=html.match(/<script type="module" crossorigin src="([^"]+)"/)[1];
 const browser=await chromium.launch({channel:'msedge',headless:true});
 let deferred=false,passed=0;const errors=[];
 const task=()=>({id:'receipt',clientId:'client',client:'Клиент',document:'SERIES:2026:FFL_TEST0111',total:2,placed:1,remaining:['BOX-1'],status:deferred?'DEFERRED':'OPEN',history:[],canFinish:false});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url()),p=u.pathname;
   const reply=(json,status=200)=>route.fulfill({json,status});
   if(p==='/placement-fixture')return route.fulfill({contentType:'text/html',body:'<html><head><script type="importmap">'+JSON.stringify(map)+'</script>'+(html.match(/<link[^>]*rel="stylesheet"[^>]*>/g)||[]).join('')+'</head><body><div id="root" hidden></div><div id="fixture"></div></body></html>'});
   if(p.includes('/api/')){
    if(p.endsWith('/placement-report'))return reply({enabled:true,summary:{pallets:1,boxes:2,awaiting:1},items:u.searchParams.get('summaryOnly')?[]:[{id:'box',code:'BOX-1',clientId:'client',client:'Клиент',receipt:'SERIES:2026:FFL_TEST0111',receiptAt:'2026-11-01T09:00:00Z'}],nextCursor:null});
    if(p.endsWith('/receipt-placement/action')){const body=route.request().postDataJSON();assert(['FINISH','DEFER'].includes(body.action));deferred=body.action==='DEFER';return reply(task());}
    if(p.endsWith('/receipt-placement'))return reply({items:[task(),{...task(),id:'done',document:'SERIES:2026:COMPLETED_FIXTURE',placed:2,remaining:[],status:'COMPLETED'}]});
    if(p.endsWith('/storage-locations'))return reply({warehouse:{id:'wh',code:'TEST',name:'Филиал'},zones:[],pallets:[],summary:{zones:0,pallets:0,boxes:0,unassignedPallets:0},codePrefixes:{pallet:'PALLET',storageCell:'CELL',rackSlot:'SLOT',rack:'RACK',storageBox:'SBOX'},googleSync:{error:null}});
    if(p.endsWith('/clients'))return reply([]);
    if(p.endsWith('/panthera-favorites'))return reply({ids:[],initialized:true});
    if(p.includes('/auth/'))return reply({},401);
    return reply({});
   }
   if(u.origin!==origin)return route.abort();
   try{
    let body=await bytes(p.slice(1));
    if(p===core){const text=body.toString(),dom=text.match(/([\w$]+)\.createRoot\(document\.getElementById\("root"\)\)/)[1];body=Buffer.from(text+'\nexport const __TestStorage=C5,__TestNav=__MainFeatures.PantheraNavigation,__TestSpace=T4,__TestDOM='+dom+',__TestReact=x;');}
    return route.fulfill({contentType:p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream',body});
   }catch(e){errors.push(p+' '+e.message);return route.abort();}
  });
  await page.goto(origin+'/placement-fixture');
  await page.evaluate(async(core)=>{
   const m=await import(core),R=m.__TestReact;
   window.fixture=m.__TestDOM.createRoot(document.getElementById('fixture'));
   const session={accessToken:'synthetic',user:{id:'user',activeWarehouseId:'wh',permissionCodes:['warehouse:read','warehouse:write'],roleCodes:['ADMIN']}};
   const groups=[{id:'warehouse',title:'Склад',items:[{id:'storage-zones',title:'Зоны хранения',icon:p=>R.createElement('span',p)}]}];
   window.fixture.render(R.createElement(R.Fragment,null,R.createElement(m.__TestNav,{groups,userId:'user',accessToken:'synthetic',warehouseId:'wh',activeId:'storage-zones',onOpen:()=>{},kizUnread:0}),R.createElement(m.__TestStorage,{session})));
  },core);
  await page.getByLabel('Ожидают размещения: 1',{exact:true}).waitFor();passed++;
  assert.equal(await page.getByText(/COMPLETED_FIXTURE/).count(),0);
  await page.getByRole('button',{name:'1 Ожидают размещения'}).click();
  const dialog=page.getByRole('dialog',{name:'Ожидают размещения',exact:true});await dialog.getByText('BOX-1',{exact:true}).waitFor();passed++;
  await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);passed++;
  await page.getByLabel('Приёмки для размещения').locator('summary').first().click();
  await page.getByRole('button',{name:'Завершить размещение',exact:true}).click();
  const warning=page.getByRole('dialog',{name:'Не все короба размещены'});await warning.getByText('BOX-1',{exact:true}).waitFor();passed++;
  await warning.getByRole('button',{name:'Отложить',exact:true}).click();await page.locator('summary').filter({hasText:'отложено'}).waitFor();assert(deferred);passed++;
  assert.deepEqual(errors,[]);passed++;
  fs.writeFileSync(path.join(root,(publicMode?'public-':'')+'browser-proof.json'),JSON.stringify({passed,publicMode,errors,syntheticOnly:true}));
  console.log({passed,publicMode});
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

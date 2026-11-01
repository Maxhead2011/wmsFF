// TEST: actual published module graph, synthetic APIs and no real actions.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),publicMode=process.argv.includes('--public'),origin='https://wms.logoff.pro';
let passed=0,reads=0,fail=false,gateCalls=0;const errors=[];
let view={plannedQuantity:578,canWrite:true,canGate:true,connections:[{id:'c',accountName:'Тестовый кабинет'}],binding:null};
async function bytes(n){const cache=path.join(root,publicMode?'public-browser-cache':'browser-cache',n);if(fs.existsSync(cache))return fs.readFileSync(cache);if(!publicMode)for(const f of ['web/payload','web-base']){let p=path.join(root,f,n);if(fs.existsSync(p))return fs.readFileSync(p);}const r=await fetch(origin+'/'+n);assert(r.ok,n);const b=Buffer.from(await r.arrayBuffer());fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,b);return b;}
(async()=>{const html=(await bytes('index.html')).toString(),map=JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]),core=map.imports['/assets/admin-tiles-20261019-0.js'],wb=map.imports['/assets/admin-tiles-20261019-4.js'];
assert.equal(html.match(/<script type="module" crossorigin src="([^"]+)"/)[1],core);passed++;
const links=(html.match(/<link[^>]*rel="stylesheet"[^>]*>/g)||[]).join(''),browser=await chromium.launch({channel:'msedge',headless:true});
try{const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('**/*',async route=>{const u=new URL(route.request().url()),p=u.pathname,reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
if(p.includes('/api/')){
 if(p.endsWith('/market-status/targets'))return reply([{id:'a',number:1},{id:'b',number:2}]);
if(p.endsWith('/market-status')){assert.equal(route.request().method(),'POST');return p.includes('/a/')?reply({status:'DONE',message:'WB',checkedAt:new Date().toISOString()}):reply({message:'Bind required'},409);}
 if(p.includes('/wb-fbo-supply')){reads++;if(p.endsWith('/bind')){assert.deepEqual(route.request().postDataJSON(),{connectionId:'c',input:'41834673'});view.binding={supplyId:'41834673',statusId:3,status:'Отгрузка разрешена',warehouse:'СЦ Радумля',quantity:578,acceptedQuantity:0,checkedAt:'2026-10-30T17:00:00Z'};}
 if(p.endsWith('/gate')){gateCalls++;view.dispatch={at:'2026-10-30T17:30:00Z'};}
 if(fail&&p.endsWith('/refresh'))return reply({message:'WB временно недоступен'},502);
 return reply(view);}
 if(p.endsWith('/auth/me')||p.endsWith('/auth/refresh'))return reply({},401);
 return reply({});
}
if(u.origin!==origin)return route.abort();
if(p==='/__wb_test')return route.fulfill({contentType:'text/html',body:'<html><head><script type="importmap">'+JSON.stringify(map)+'</script>'+links+'</head><body><div id="root" hidden></div><div id="fixture"></div></body></html>'});
try{let b=await bytes(p.slice(1));if(p===core){const s=b.toString(),alias=s.match(/([\w$]+)\.createRoot\(document\.getElementById\("root"\)\)/)?.[1];assert(alias);b=Buffer.from(s+'\nexport {'+alias+' as __TestReactDOM,Wq as __TestChangeStatus};');}
if(p===wb)b=Buffer.from(b.toString()+'\nexport const __TestTracking=__WbTracking.WbFboSupply;export const __TestButtons=__MarketButtons;export const __TestHooks=__BatchFeatures;export const __TestPanel=__OnlinePanel.FboTwoStagePanel;');
return route.fulfill({contentType:p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream',body:b});}catch(e){errors.push(String(e));return route.abort();}
});
const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/__wb_test');
await page.evaluate(async()=>{
 const core=await import('/assets/admin-tiles-20261019-0.js'),w=await import('/assets/admin-tiles-20261019-4.js'),R=core.r;
 window.fixtureRoot=core.__TestReactDOM.createRoot(document.getElementById('fixture'));
 window.testPlan={requestId:'r',number:2564,title:'Сборка из Excel',marketplace:'WILDBERRIES',phase:'PICKING',needed:578,picked:1,packed:0,looseRemaining:577,shortage:0,compositionChanged:false,wholeBoxes:[],lines:[],route:[],boxes:[]};
 window.fixtureRoot.render(R.createElement(w.__TestPanel,{initial:window.testPlan,accessToken:'synthetic',userId:'fixture',canWrite:true,onClose:()=>{}}));
});
const header=page.locator('.online-execution-modal__header').last();
await header.getByRole('button',{name:'Поставка ВБ',exact:true}).click();passed++;
const dialog=page.locator('dialog[open]');await dialog.getByLabel('Ссылка или номер поставки WB').fill('41834673');
await dialog.getByRole('button',{name:'Привязать поставку WB',exact:true}).click();
await dialog.getByText('Не подтверждена',{exact:false}).waitFor();assert.equal(gateCalls,0);passed++;
await dialog.getByRole('button',{name:'Закрыть окно'}).click();assert(await header.isVisible());passed++;
await header.getByRole('button',{name:'Поставка ВБ',exact:true}).click();await dialog.getByText(/WB №41834673/).waitFor();passed++;
await dialog.getByRole('button',{name:'Закрыть окно'}).click();
await page.evaluate(async()=>{
 const core=await import('/assets/admin-tiles-20261019-0.js'),w=await import('/assets/admin-tiles-20261019-4.js'),R=core.r;
 function Fixture(){const [busy,setBusy]=R.useState(false);
 return w.__TestHooks.useRequestBatch({items:[],enabled:true,token:'synthetic',reload:async()=>{},checkingMarkets:busy,
 marketControl:b=>R.createElement(w.__TestButtons.MarketStatusBatch,{token:'synthetic',reload:async()=>{},disabled:b,onBusy:setBusy})}).controls;}
 window.fixtureRoot.render(R.createElement(Fixture));
});
const batch=page.getByRole('button',{name:'Проверить статусы всех заявок',exact:true});await batch.waitFor();
assert.equal(await batch.count(),1);assert.equal(await page.getByRole('checkbox').isChecked(),false);passed++;
await batch.click();await page.getByText(/Проверено заявок: 2/).waitFor();passed++;
await page.getByText(/Перешли в «Сдано» — 1/).waitFor();await page.getByText(/Требуют внимания — 1/).waitFor();passed++;
await page.getByText('Результаты по всем заявкам').click();await page.getByText(/№1 · WB/).waitFor();passed++;
assert.deepEqual(errors,[]);passed++;
fs.writeFileSync(path.join(root,(publicMode?'public-':'')+'browser-proof.json'),JSON.stringify({passed,publicMode,gateCalls,errors,syntheticOnly:true}));console.log({passed,publicMode});
}finally{await browser.close();}})().catch(e=>{console.error(e,errors);process.exitCode=1});

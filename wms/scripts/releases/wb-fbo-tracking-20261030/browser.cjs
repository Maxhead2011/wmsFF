// TEST: actual published module graph, synthetic APIs and no real actions.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),publicMode=process.argv.includes('--public'),origin='https://wms.logoff.pro';
let passed=0,reads=0,fail=false,gateCalls=0;const errors=[];
let view={plannedQuantity:578,canWrite:true,canGate:true,connections:[{id:'c',accountName:'Тестовый кабинет'}],binding:null};
async function bytes(n){const cache=path.join(root,'browser-cache',n);if(fs.existsSync(cache))return fs.readFileSync(cache);if(!publicMode)for(const f of ['web/payload','web-base']){let p=path.join(root,f,n);if(fs.existsSync(p))return fs.readFileSync(p);}const r=await fetch(origin+'/'+n);assert(r.ok,n);const b=Buffer.from(await r.arrayBuffer());fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,b);return b;}
(async()=>{const html=(await bytes('index.html')).toString(),map=JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]),core=map.imports['/assets/admin-tiles-20261019-0.js'],wb=map.imports['/assets/admin-tiles-20261019-4.js'];
assert.equal(html.match(/<script type="module" crossorigin src="([^"]+)"/)[1],core);passed++;
const links=(html.match(/<link[^>]*rel="stylesheet"[^>]*>/g)||[]).join(''),browser=await chromium.launch({channel:'msedge',headless:true});
try{const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('**/*',async route=>{const u=new URL(route.request().url()),p=u.pathname,reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
if(p.includes('/api/')){
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
if(p===wb)b=Buffer.from(b.toString()+'\nexport const __TestTracking=__WbTracking.WbFboSupply;export const __TestTable=ui;export const __TestPanel=__OnlinePanel.FboTwoStagePanel;');
return route.fulfill({contentType:p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream',body:b});}catch(e){errors.push(String(e));return route.abort();}
});
const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/__wb_test');
async function render(requestId='r',disabled=false){await page.evaluate(async({requestId,disabled})=>{const m=await import('/assets/admin-tiles-20261019-0.js'),w=await import('/assets/admin-tiles-20261019-4.js');if(!w.__TestTracking)throw Error('Missing tracking export:'+Object.keys(w));if(!m.r?.createElement)throw Error('Missing React:'+Object.keys(m));window.fixtureRoot??=m.__TestReactDOM.createRoot(document.getElementById('fixture'));window.fixtureRoot.render(m.r.createElement(w.__TestTracking,{key:requestId,requestId,accessToken:'synthetic',disabled}));},{requestId,disabled});}
await render();await page.getByRole('button',{name:'Привязать поставку WB',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Привязать поставку WB',exact:true}).isDisabled());passed++;
await page.getByLabel('Ссылка или номер поставки WB').fill('41834673');await page.getByRole('button',{name:'Привязать поставку WB',exact:true}).click();await page.getByText('Не подтверждена',{exact:false}).waitFor();assert.equal(gateCalls,0);passed++;
page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Отгружено',exact:true}).click();await page.getByText(/Отгружено ·/).waitFor();assert.equal(gateCalls,1);passed++;
view.binding.statusId=5;view.binding.status='Принято';view.binding.acceptedQuantity=578;await page.getByRole('button',{name:'Проверить статус WB',exact:true}).click();await page.getByText(/Сдано · Принято/).waitFor();passed++;
fail=true;await page.getByRole('button',{name:'Проверить статус WB',exact:true}).click();await page.getByRole('alert').filter({hasText:'WB временно недоступен'}).waitFor();assert(await page.getByText(/Сдано · Принято/).isVisible());passed++;
fail=false;view={...view,binding:null,canWrite:false,connections:[]};await render('other');await page.getByText('Привязку выполняет пользователь с правом изменения заявки.').waitFor();assert.equal(await page.getByText(/Сдано · Принято/).count(),0);passed++;
view={...view,canWrite:true,canGate:false,dispatch:null,connections:[{id:'c',accountName:'Test'}],binding:{supplyId:'2',statusId:3,status:'Отгрузка разрешена',warehouse:'Test',quantity:578,acceptedQuantity:0,checkedAt:'2026-10-30T17:00:00Z'}};await render('incomplete');await page.getByRole('button',{name:'Отгружено',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Отгружено',exact:true}).isDisabled());passed++;
await page.evaluate(async()=>{const m=await import('/assets/admin-tiles-20261019-0.js'),w=await import('/assets/admin-tiles-20261019-4.js');window.fixtureRoot.render(m.r.createElement(w.__TestTable,{items:[{id:'r',number:2494,title:'FBO fixture',type:'OUTBOUND',status:'PACKED',fboDispatchAt:'today',priority:'NORMAL',createdAt:'2026-10-30T10:00:00Z',client:{name:'Test',code:'TEST'},items:[],packages:[],files:[],_count:{fbsOrderLinks:0}}],canChangeStatus:true,onStatusChange:()=>{}}));});
const select=page.getByRole('combobox',{name:'Статус заявки FBO fixture'}).first();await select.waitFor();assert.deepEqual(await select.locator('option').allTextContents(),['Новая','В работе','Упакована','Отгружено','Сдано','Отменена']);assert.equal(await select.inputValue(),'SHIPPED');passed++;
assert.deepEqual(errors,[]);await page.screenshot({path:root+'/'+(publicMode?'public-':'')+'wb-tracking.png'});const proof={passed,reads,gateCalls,errors,syntheticOnly:true,publicMode};fs.writeFileSync(root+'/'+(publicMode?'public-':'')+'browser-proof.json',JSON.stringify(proof));console.log(proof);
}finally{await browser.close();}})().catch(e=>{console.error(e,errors);process.exitCode=1});

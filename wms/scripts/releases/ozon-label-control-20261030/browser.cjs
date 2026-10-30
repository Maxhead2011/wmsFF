// TEST: run the candidate/published module graph with synthetic APIs only.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),publicMode=process.argv.includes('--public'),origin='https://wms.logoff.pro';
let clicks=0,fail=false;const errors=[];
async function bytes(n){if(!publicMode)for(const f of ['web/payload','web-base']){let p=path.join(root,f,n);if(fs.existsSync(p))return fs.readFileSync(p);}const r=await fetch(origin+'/'+n);assert(r.ok,n);return Buffer.from(await r.arrayBuffer());}
(async()=>{const html=(await bytes('index.html')).toString(),map=JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]),core=map.imports['/assets/admin-tiles-20261019-0.js'],ozon=map.imports['/assets/admin-tiles-20261019-14.js'];
const links=(html.match(/<link[^>]*rel="stylesheet"[^>]*>/g)||[]).join('');
const browser=await chromium.launch({channel:'msedge',headless:true});try{const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('**/*',async route=>{const u=new URL(route.request().url()),p=u.pathname,reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
if(p.includes('/api/')){
 if(p.endsWith('/label-download')){clicks++;assert.deepEqual(route.request().postDataJSON(),{supplyId:'42'});return fail?reply({message:'Не удалось записать историю'},500):reply({url:origin+'/test-label.pdf'});}
 if(p.endsWith('/supply'))return reply({connections:[],directions:[{name:'Москва',items:[{quantity:1}]}],differences:[],packingError:'',link:{connectionId:'c',orderId:'1',orderNumber:'1',place:'Москва',date:'',state:'DATA_FILLING',frozenHash:'hash',mapping:{Москва:'42'},supplies:[{id:'42',name:'Москва',items:[{quantity:1}]}],operations:{'42':{state:'SUCCESS',labelOperationId:'op',labelUrl:origin+'/test-label.pdf'}}}});
 if(p.endsWith('/auth/me')||p.endsWith('/auth/refresh'))return reply({},401);
 return reply({});
}
if(u.origin!==origin)return route.abort();
if(p==='/test-label.pdf')return route.fulfill({contentType:'text/html',body:'Synthetic label'});
if(p==='/__label_test')return route.fulfill({contentType:'text/html',body:'<html><head><script type="importmap">'+JSON.stringify(map)+'</script>'+links+'</head><body><div id="root" hidden></div><div id="fixture"></div></body></html>'});
try{let b=await bytes(p.slice(1));if(p===core){let s=b.toString(),alias=s.match(/([\w$]+)\.createRoot\(document\.getElementById\("root"\)\)/)?.[1];assert(alias);b=Buffer.from(s+'\nexport {'+alias+' as __TestReactDOM,g$ as __TestTimeline};');}if(p===ozon){const code=b.toString();assert(code.includes('function M(props){return __OzonSupplyLayout'));b=Buffer.from(code.replace('function M(props){return __OzonSupplyLayout','globalThis.__labelTestSupply=__OzonSupplyLayout.OzonAssemblySupply;function M(props){return __OzonSupplyLayout')+'\nexport const __TestSupply=globalThis.__labelTestSupply;');}return route.fulfill({contentType:p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream',body:b});}catch(e){errors.push(String(e));return route.abort();}
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/__label_test');
await page.evaluate(async()=>{const m=await import('/assets/admin-tiles-20261019-0.js'),o=await import('/assets/admin-tiles-20261019-14.js');window.fixtureRoot=m.__TestReactDOM.createRoot(document.getElementById('fixture'));window.fixtureRoot.render(m.r.createElement(o.__TestSupply,{requestId:'r',accessToken:'test'}));});
await page.getByRole('button',{name:'Скачать стикеры Ozon',exact:true}).waitFor();assert.equal(clicks,0);
assert(await page.getByText(/наш ШК → ШК стикера Ozon/).isVisible());
const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Скачать стикеры Ozon',exact:true}).click();const popup=await popupPromise;await popup.waitForURL('**/test-label.pdf');assert.equal(clicks,1);await popup.close();await page.getByRole('status').filter({hasText:'записано в историю'}).waitFor();
fail=true;await page.getByRole('button',{name:'Скачать стикеры Ozon',exact:true}).click();await page.getByRole('alert').filter({hasText:'Не удалось записать историю'}).waitFor();assert.equal(clicks,2);
await page.evaluate(async()=>{const m=await import('/assets/admin-tiles-20261019-0.js');window.fixtureRoot.render(m.r.createElement(m.__TestTimeline,{timeline:{request:{number:2507,title:'Test',type:'OUTBOUND',status:'IN_WORK',client:{code:'TEST'}},comments:[],events:[{id:'e',title:'Нажата кнопка «Скачать стикеры Ozon»',body:'Короб FFL_TEST · поставка 42',createdAt:'2026-10-30T07:08:33Z',createdBy:{name:'Соня'}}]},onClose:()=>{},onAddComment:()=>{}}));});
await page.getByText('30.10.2026, 10:08:33 МСК · Соня',{exact:true}).waitFor();assert.deepEqual(errors,[]);await page.screenshot({path:root+'/'+(publicMode?'public-':'')+'history.png'});
const proof={passed:6,clicks,errors,syntheticOnly:true,publicMode};fs.writeFileSync(root+'/'+(publicMode?'public-':'')+'browser-proof.json',JSON.stringify(proof));console.log(JSON.stringify(proof));
}finally{await browser.close();}})().catch(e=>{console.error(e,errors);process.exitCode=1});

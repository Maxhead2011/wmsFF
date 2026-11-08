// TEST: load the actual runtime module and import map; all API traffic is synthetic.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),publicUrl=process.env.PUBLIC_URL;
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await b.newPage({ignoreHTTPSErrors:true}),errors=[];p.on('pageerror',e=>errors.push(e.message));let total=7,fail=false;
 await p.route('**/api/**',r=>r.fulfill({status:fail?500:200,json:r.request().url().includes('fbo-active-counts')?{wb:1,ozon:2,lamoda:3,yandex:total}:[]}));
 const html=fs.readFileSync(root+'/web-payload/index.html','utf8'),map=html.match(/<script type="importmap">.*?<\/script>/s)[0];
 await p.route('**/counter-test',r=>r.fulfill({contentType:'text/html',body:map+'<div id="root"></div><div id="counter-root"></div>'}));
 if(!publicUrl)await p.route('**/assets/**',r=>{let name=new URL(r.request().url()).pathname;const file=[root+'/web-payload'+name,root+'/web-base'+name].find(fs.existsSync);return file?r.fulfill({path:file,contentType:name.endsWith('.css')?'text/css':'application/javascript'}):r.abort()});
 await p.goto((publicUrl||'http://counter.test')+'/counter-test');
 await p.evaluate(async()=>{const core=await import('/assets/admin-tiles-20261019-0.js'),fbo=await import('/assets/yandex-fby-counter-20261108.js');window.testRoot=core.__FbyReactDOM.createRoot(document.getElementById('counter-root'));window.renderCounter=(warehouse='moscow')=>window.testRoot.render(core.r.createElement(fbo.FboWorkspace,{session:{accessToken:'synthetic',user:{roleCodes:[],permissionCodes:['system:admin'],activeWarehouseId:warehouse,clientIds:[]}}}));window.renderCounter();});
 const badge=p.locator('.fbs-marketplace-card--yandex .fbs-marketplace-card__active-count');await badge.filter({hasText:'7 заявок'}).waitFor();
 total=0;await p.evaluate(()=>window.renderCounter('another'));await badge.filter({hasText:'0 заявок'}).waitFor();
 fail=true;await p.evaluate(()=>window.renderCounter('error'));await badge.filter({hasText:'Не удалось загрузить'}).waitFor();
 assert.equal(await p.locator('.fbs-marketplace-card__active-count').count(),4);assert.deepEqual(errors,[]);
 await p.screenshot({path:root+'/'+(publicUrl?'public':'candidate')+'-counter.png'});fs.writeFileSync(root+'/'+(publicUrl?'public':'runtime')+'-browser-proof.json',JSON.stringify({passed:4,syntheticOnly:true}));console.log('4 runtime browser checks passed');
 }finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});


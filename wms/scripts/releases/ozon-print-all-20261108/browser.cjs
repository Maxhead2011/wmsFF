// TEST: real current module graph, synthetic API; never send a real print job.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),publicUrl=process.env.PUBLIC_URL;
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await b.newPage({ignoreHTTPSErrors:true}),errors=[];p.on('pageerror',e=>errors.push(e.message));let jobs=[],fail=false,ambiguous=false;
 const manifest={clientId:'client',fingerprint:'same',total:2,supplies:[{id:'1',name:'Ростов',cargoIds:['111']},{id:'2',name:'Москва',cargoIds:['222']}]};
 await p.route('**/api/**',async r=>{const url=r.request().url(),body=r.request().postDataJSON();
  if(url.endsWith('/print/series/stations'))return r.fulfill({json:[{id:'station',name:'ОЗОН',printerName:'70 × 120'}]});
  if(url.endsWith('/print-labels')){if(fail&&body?.supplyId==='2')return r.fulfill({status:429,json:{message:'Ozon: HTTP 429'}});return r.fulfill({json:body?.supplyId?{...manifest,widthMm:120,heightMm:75,pages:[{value:body.supplyId==='1'?'111':'222',imageBase64:'synthetic'}]}:manifest});}
  if(url.endsWith('/print/series/jobs')){jobs.push(body);if(ambiguous){ambiguous=false;return r.abort('failed')}return r.fulfill({json:{id:'series:test',pages:2,status:'queued'}});}
  return r.fulfill({json:[]});
 });
 const html=fs.readFileSync(root+'/web-payload/index.html','utf8'),map=html.match(/<script type="importmap">.*?<\/script>/s)[0];
 await p.route('**/all-labels-test',r=>r.fulfill({contentType:'text/html',body:map+'<style>#root{display:none}</style><div id="root"></div><div id="test-root"></div>'}));
 if(!publicUrl)await p.route('**/assets/**',r=>{const name=new URL(r.request().url()).pathname,file=[root+'/web-payload'+name,root+'/web-base'+name].find(fs.existsSync);return file?r.fulfill({path:file,contentType:name.endsWith('.css')?'text/css':'application/javascript'}):r.abort()});
 await p.goto((publicUrl||'https://print.test')+'/all-labels-test');
 await p.evaluate(async()=>{const core=await import('/assets/admin-tiles-20261019-0.js'),part=await import('/assets/ozon-print-all-component-20261108.js');window.rt=core.__FbyReactDOM.createRoot(document.getElementById('test-root'));const C=part.createOzonPrintAll(core.r);window.draw=(key,ready)=>window.rt.render(core.r.createElement(C,{key,requestId:key,accessToken:'synthetic',ready}));window.draw('disabled',false)});
 const open=p.getByRole('button',{name:'Распечатать все этикетки',exact:true}),print=p.getByRole('button',{name:'Подтвердить печать всех этикеток',exact:true});
 await open.waitFor();assert(await open.isDisabled());
 await p.evaluate(()=>window.draw('all',true));await open.click();await print.waitFor();assert.equal(await p.locator('select').inputValue(),'station');
 await print.evaluate(e=>{e.click();e.click()});await p.getByRole('status').filter({hasText:'В очередь отправлено 2'}).waitFor();assert.equal(jobs.length,1);assert.deepEqual(jobs[0].pages.map(p=>p.value),['111','222']);assert.equal(jobs[0].widthMm,120);assert.equal(jobs[0].heightMm,75);assert(await print.isDisabled());
 await p.evaluate(()=>window.draw('failure',true));fail=true;await open.click();await print.click();await p.getByRole('status').filter({hasText:'429'}).waitFor();assert.equal(jobs.length,1);
 fail=false;ambiguous=true;await print.click();await p.getByRole('status').filter({hasText:'Failed to fetch'}).waitFor();await print.click();await p.getByRole('status').filter({hasText:'В очередь отправлено 2'}).waitFor();assert.equal(jobs.length,3);assert.equal(jobs[1].requestId,jobs[2].requestId);
 assert.deepEqual(errors,[]);await p.screenshot({path:root+'/'+(publicUrl?'public':'candidate')+'-print-all.png'});
 fs.writeFileSync(root+'/'+(publicUrl?'public':'runtime')+'-browser-proof.json',JSON.stringify({passed:8,syntheticOnly:true}));console.log('8 browser checks passed');
 }finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});

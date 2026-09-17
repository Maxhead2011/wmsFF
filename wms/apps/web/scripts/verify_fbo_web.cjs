// TEST: real-browser regression for live FBO counters, pending operations and the WB/Ozon entry point.
// Run with Playwright available through NODE_PATH; optional BROWSER_EXECUTABLE selects an installed browser.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.argv[2]||'fbo-browser-results');
const pnpm=path.resolve(root,'../../node_modules/.pnpm');
const esbuild=require(path.join(pnpm,fs.readdirSync(pnpm).filter(n=>n.startsWith('esbuild@')).sort().at(-1),'node_modules/esbuild'));
const plan={requestId:'r',number:1029,title:'Сборка из Excel',phase:'PICKING',needed:6,picked:1,packed:0,looseRemaining:1,shortage:0,compositionChanged:false,wholeBoxes:[],boxes:[],
 lines:[{id:'l',skuId:'s',name:'Реглан',article:'светлмеланж',size:'M / 46',barcode:'2047945565575',requiresKiz:true,needed:6,picked:1,packed:0,remaining:5}],
 route:[{boxCode:'FFL_20',pallet:'PALET_SORT_01',zone:'4',wholeBox:false,recount:false,tasks:[{skuId:'s',barcode:'2047945565575',name:'Реглан',quantity:5,requiresKiz:true}]}],pickedUnits:[]};
const session={accessToken:'fixture-only',tokenType:'Bearer',user:{id:'viewer',name:'Viewer',roleCodes:['CLIENT'],permissionCodes:['client-requests:read','stock:read'],clientScopeMode:'LIMITED',clientIds:['c'],writableClientIds:[]}};
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {FboTwoStagePanel} from './src/components/client-requests/FboTwoStagePanel';import {FboWorkspace} from './src/components/client-requests/FboWorkspace';import './src/styles.css';import './src/components/client-requests/client-requests.css';const p=${JSON.stringify(plan)};createRoot(document.getElementById('root')).render(location.search.includes('workspace')?<FboWorkspace session={${JSON.stringify(session)}}/>:<FboTwoStagePanel initial={p} accessToken="fixture-only" userId="viewer" canWrite={false} onClose={()=>{}}/>);`,resolveDir:root,loader:'tsx'},bundle:true,external:['/cursors/*'],jsx:'automatic',outfile:path.join(output,'app.js'),define:{'import.meta.env':JSON.stringify({VITE_FBO_WORKSPACE_ENABLED:'true'}),'process.env.NODE_ENV':'"production"'}});
 const server=http.createServer((req,res)=>{const name=req.url.split('?')[0];if(name==='/'){res.setHeader('Content-Type','text/html');res.end('<html lang="ru"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');}else if(['/app.js','/app.css'].includes(name)){res.setHeader('Content-Type',name.endsWith('css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(output,name.slice(1))));}else{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));let reads=0,writes=0;
  const request={id:'r',number:1029,clientId:'c',type:'OUTBOUND',status:'IN_WORK',priority:'NORMAL',title:'Сборка из Excel',comment:null,createdAt:'2026-09-16T09:00:00Z',updatedAt:'2026-09-17T09:00:00Z',client:{id:'c',code:'LK',name:'Тестовый клиент'},createdBy:null,assignedTo:null,items:[{id:'l',skuId:'s',name:'Реглан',barcode:'2047945565575',quantity:6}],files:[],packages:[],_count:{fbsOrderLinks:0}};
  await page.route('**/api/v1/**',async route=>{
   if(route.request().method()!=='GET')writes++;reads++;
   const next={...plan,picked:3,packed:1,observedAt:new Date().toISOString(),lines:plan.lines.map(l=>({...l,picked:3,packed:1,remaining:3})),route:plan.route.map(r=>({...r,tasks:r.tasks.map(t=>({...t,quantity:3}))}))};
   const endpoint=new URL(route.request().url()).pathname;
   const json=endpoint==='/api/v1/client-requests'?[request,{...request,id:'manual',number:1030,title:'Ручная заявка'},{...request,id:'fbs',title:'FBS скрытая',_count:{fbsOrderLinks:1}},{...request,id:'inbound',type:'INBOUND',title:'Приёмка скрытая'}]:endpoint==='/api/v1/tsd/requests/r'?{fbo:plan}:endpoint==='/api/v1/tsd/requests/r/fbo'?next:[];
   await route.fulfill({json});
  });
  const url=`http://127.0.0.1:${server.address().port}`;
  await page.clock.install();await page.goto(url);
  await page.waitForSelector('.online-execution-metrics');
  assert.equal(await page.locator('.online-execution-metrics article').nth(1).locator('strong').innerText(),'1');
  await page.clock.fastForward(5000);
  await page.waitForFunction(()=>document.querySelectorAll('.online-execution-metrics strong')[1]?.textContent==='3');
  assert.equal(await page.locator('.online-execution-metrics article').nth(2).locator('strong').innerText(),'1');assert.equal(writes,0);assert.ok(reads>=1);
  await page.screenshot({path:path.join(output,'live-progress.png'),fullPage:true});
  const pending={action:'PICK_UNIT',operationId:'unchanged-operation',sourceBoxCode:'FFL_20',barcode:'2047945565575',kiz:'same-kiz'};
  await page.evaluate(value=>localStorage.setItem('fbo-pending:viewer:r',JSON.stringify(value)),pending);await page.reload();await page.waitForSelector('.online-execution-metrics');
  const before=reads;await page.clock.fastForward(10000);assert.equal(reads,before);assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('fbo-pending:viewer:r'))),pending);
  await page.goto(url+'?workspace');await page.getByRole('button',{name:/FBO WB/}).waitFor();await page.getByRole('button',{name:/FBO Ozon/}).waitFor();
  await page.screenshot({path:path.join(output,'fbo-menu.png'),fullPage:true});
  await page.evaluate(()=>localStorage.removeItem('fbo-pending:viewer:r'));
  await page.getByRole('button',{name:/FBO WB/}).click();await page.getByRole('heading',{name:'Заявки FBO WB',exact:true}).waitFor();
  await page.getByRole('button',{name:'Открыть заявку Сборка из Excel',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Открыть заявку Ручная заявка',exact:true}).count(),1);
  assert.equal(await page.getByText('FBS скрытая',{exact:true}).count(),0);assert.equal(await page.getByText('Приёмка скрытая',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Открыть заявку Сборка из Excel',exact:true}).click();await page.waitForSelector('.fbo-progress');
  await page.clock.fastForward(5000);await page.waitForFunction(()=>document.querySelectorAll('.online-execution-metrics strong')[1]?.textContent==='3');
  assert.equal(writes,0);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,liveCounters:true,pendingPreserved:true,menu:true,writeRequests:writes},null,2));
  console.log('FBO live browser checks passed');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});

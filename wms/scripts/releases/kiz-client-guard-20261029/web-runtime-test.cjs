// TEST: exercise the exact patched published module; only a test export is appended in memory.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(process.argv[2]);
const manifest=JSON.parse(fs.readFileSync(root+'/web/manifest.json','utf8'));
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://local').pathname;
 const relative=pathname==='/'?'index.html':pathname.slice(1);
 if(relative.includes('..')){res.writeHead(400);res.end();return;}
 const candidate=path.join(root,'web/payload',relative),file=fs.existsSync(candidate)?candidate:path.join(root,'web-base',relative);
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 let bytes=fs.readFileSync(file);
 if(relative===manifest.artifact)bytes=Buffer.concat([bytes,Buffer.from('\nwindow.__KizClientRuntime={React:x,DOM:j5,Receipt:LC,Queue:f4,Card:p4};\n')]);
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{}});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const kiz='010464068426237821AbCdEf1234567';let receipts=0,reviews=0,decisions=0;
  await page.route('**/api/v1/**',route=>{
   const req=route.request(),p=new URL(req.url()).pathname;
   const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(p.endsWith('/warehouse/receipt-channels'))return json({rows:[],enabled:false});
   if(p.endsWith('/warehouse/online-receipts'))return json({clientId:'client',generatedAt:'2026-10-29T12:00:00Z',receipts:[],currentBatchDate:null,boxes:[{key:'box',boxId:'box',boxCode:'FFL_CURRENT',sourceDocument:'receipt',status:'receiving',totalQuantity:0,kizCount:0,items:[],currentBalances:[],kizValues:[]}]});
   if(p.endsWith('/skus'))return json([]);
   if(p.endsWith('/warehouse/online-receipts/items')){receipts++;assert.equal(req.postDataJSON().kiz,kiz);return json({code:'KIZ_DUPLICATE',message:'ОТЛОЖИТЕ ТОВАР',duplicateInfo:{identity:kiz,firstBoxCode:'FFL_ORIGINAL',currentBoxCode:'FFL_STORED',productName:'Костюм',firstReceivedAt:'2026-09-01T07:30:00Z',currentStatus:'SHIPPED'}},409);}
   if(p.endsWith('/tsd/receipts/kiz-review')){reviews++;const b=req.postDataJSON();assert.equal(b.clientId,'client');assert.equal(b.kiz,kiz);assert(b.operationKey);return json({id:'case',status:'OPEN',message:'Передано на проверку'});}
   if(p.endsWith('/inventory/kiz-found'))return json([]);
   if(p.endsWith('/inventory/kiz-location/reviews'))return json({items:decisions?[]:[{id:'case',kizIdentity:kiz,status:'OPEN',active:true,decision:'REVIEW',createdAt:'2026-09-01T07:30:00Z',attempts:1,snapshot:{scope:'RECEIPT',productName:'Костюм',workerName:'Приёмщик',boxCode:'FFL_CURRENT',requestNumber:0},evidence:{history:[]}}],nextCursor:null});
   if(p.endsWith('/inventory/kiz-location/reviews/case/decision')){assert.equal(req.postDataJSON().resolution,'REJECT');assert.equal(req.postDataJSON().confirmed,true);decisions++;return json({id:'case',status:'REJECTED',resolution:'REJECT'});}
   throw Error('Unexpected API request: '+p);
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.waitForFunction(()=>window.__KizClientRuntime);
  await page.evaluate(()=>{
   document.getElementById('root').style.display='none';
   const api=window.__KizClientRuntime,node=document.createElement('section');node.id='receipt-runtime-test';document.body.append(node);
   const session={accessToken:'synthetic-test-token',user:{id:'test-admin',roleCodes:['ADMIN'],permissionCodes:['warehouse:write','stock:write'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[]}};
   window.__KizTestSession=session;
   window.__KizTestRoot=api.DOM.createRoot(node);window.__KizTestRoot.render(api.React.createElement(api.Receipt,{session,fixedClientId:'client'}));
  });
  const panel=page.locator('#receipt-runtime-test');
  await panel.getByPlaceholder('Начните вводить ШК или товар').fill('2051234567890');
  await panel.getByPlaceholder('Если есть').fill(kiz);await panel.getByRole('button',{name:'Добавить',exact:true}).click();
  const stop=panel.getByRole('alert');await stop.waitFor();
  assert((await stop.innerText()).includes('ОТЛОЖИТЕ ТОВАР'));assert((await stop.innerText()).includes('FFL_ORIGINAL'));assert((await stop.innerText()).includes('отгружен'));
  assert.equal(await panel.getByPlaceholder('Если есть').inputValue(),kiz);assert.equal(await panel.getByRole('button',{name:'Добавить',exact:true}).isDisabled(),true);
  assert.equal(reviews,0);await panel.getByRole('button',{name:'Передать на проверку',exact:true}).click();
  await stop.getByText('Передано на проверку.',{exact:true}).waitFor();assert.equal(reviews,1);assert.equal(receipts,1);
  await panel.getByRole('button',{name:'Сканировать другой товар',exact:true}).click();assert.equal(await panel.getByRole('alert').count(),0);
  assert.equal(await panel.getByPlaceholder('Если есть').inputValue(),'');
  await page.evaluate(()=>{const api=window.__KizClientRuntime;window.__KizTestRoot.render(api.React.createElement(api.Queue,{session:window.__KizTestSession,onInspect:()=>{}}));});
  const card=panel.locator('.kiz-review-case');await card.waitFor();await card.locator('summary').click();
  assert((await card.innerText()).includes('Приёмка'));assert.equal(await card.getByRole('button',{name:'Разрешить использовать',exact:true}).isDisabled(),true);
  await card.getByRole('button',{name:'Отказать',exact:true}).click();
  await panel.getByLabel('Основание решения').fill('Физическая проверка завершена, повторный приход запрещён.');
  await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Подтвердить решение',exact:true}).click();
  await panel.getByText('Отказ сохранён. Использование КИЗ запрещено.',{exact:true}).waitFor();assert.equal(decisions,1);
  assert.deepEqual(errors,[]);
  const result={runtime:manifest.artifact,baseEntry:manifest.baseEntry,preservedRuntime:manifest.preservedRuntime,checks:16,receipts,reviews,decisions,browserErrors:errors};
  fs.writeFileSync(root+'/web/runtime-test.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});

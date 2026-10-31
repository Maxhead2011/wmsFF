// TEST: actual published module graph, with synthetic API responses and no production mutations.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(process.argv[2]);
const patched='fbo-completion-reliability-20261031.js';
const server=http.createServer(async(req,res)=>{try{
 const rel=new URL(req.url,'http://local').pathname.slice(1)||'index.html';if(rel.includes('..')||rel!=='index.html'&&!rel.startsWith('assets/')){res.writeHead(404);return res.end();}
 let p=path.join(root,'web-payload',rel);if(!fs.existsSync(p))p=path.join(root,'web-base',rel);
 if(!fs.existsSync(p)){const response=await fetch('https://wms.logoff.pro/'+rel);if(!response.ok)throw Error('asset '+response.status+' '+rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from(await response.arrayBuffer()));}
 if(process.env.TEST_LEGACY==='true'&&rel==='assets/'+patched)p=path.join(root,'processing-terms-20261031-2.js');let s=fs.readFileSync(p);if(rel==='assets/processing-terms-20261031-0.js')s=Buffer.from(s.toString()+'\nwindow.__RecoveryDOM=iT;');
 if(rel==='assets/'+patched)s=Buffer.from(s.toString()+'\nwindow.__Recovery={React:a,Component:ut};');
 res.writeHead(200,{'Content-Type':rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':'application/octet-stream'});res.end(s);
 }catch(e){console.error(e.message);res.writeHead(500);res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage(),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message)});let applies=0,failRefresh=false,completed=false,tokens=[];
 const request={id:'r',number:2565,title:'Test FBO',status:'IN_WORK',warehouse:{name:'Test'}};
 const details=()=>({request,phase:completed?'COMPLETED':'CONTROL',pendingWhole:[],units:[{id:'u',barcode:'123',state:'PACKED',sourceBoxCode:'B',targetBoxCode:'B',kiz:null}],boxes:[{boxCode:'B',wholeBox:false,quantity:1,closedAt:'2026-10-31',confirmedAt:'2026-10-31',mismatches:[]}],movements:[]});
 await page.route('**/api/v1/**',async route=>{
  const url=new URL(route.request().url()),p=url.pathname;
  if(p.endsWith('/fbo-problems'))return route.fulfill({json:[request]});
  if(p.endsWith('/fbo-problems/r')){if(failRefresh){failRefresh=false;return route.fulfill({status:500,json:{message:'Internal server error'}});}return route.fulfill({json:details()});}
  if(p.endsWith('/preview'))return route.fulfill({json:{token:'same-durable-token',summary:{availableStockChange:0,packingStockChange:-1,affectedBoxes:['B'],units:[]}}});
  if(p.endsWith('/apply')){applies++;tokens.push(route.request().postDataJSON().token);await new Promise(r=>setTimeout(r,350));if(applies===1)return route.fulfill({status:500,json:{message:'Internal server error'}});completed=true;failRefresh=true;return route.fulfill({json:{applied:true}});}
  return route.fulfill({json:[]});
 });
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__RecoveryDOM);
 await page.evaluate(async name=>{await import('/assets/'+name);document.getElementById('root').style.display='none';const n=document.createElement('section');n.id='test';document.body.append(n);window.testRoot=window.__RecoveryDOM.createRoot(n);const a=window.__Recovery;window.testRoot.render(a.React.createElement(a.Component,{session:{accessToken:'synthetic',user:{id:'a',isDemo:false,roleCodes:['OWNER']}}}));},patched);
 const panel=page.locator('#test');await panel.getByRole('combobox').nth(0).selectOption('r');await panel.getByText('Test FBO',{exact:true}).waitFor();
 await panel.getByRole('combobox').nth(1).selectOption('FINISH');await panel.getByLabel('Причина',{exact:true}).fill('Физически проверено');await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Предпросмотр изменений'}).click();
 await panel.getByRole('button',{name:'Применить изменения'}).click();await panel.getByRole('status').filter({hasText:'Выполняется'}).waitFor();assert(await panel.getByRole('button',{name:'Применить изменения'}).isDisabled());
 await panel.getByRole('button',{name:'Проверить результат'}).waitFor();assert.equal(applies,1);assert(await panel.getByRole('button',{name:'Применить изменения'}).isEnabled());
 await panel.getByRole('button',{name:'Проверить результат'}).click();await panel.getByText('Заявка обновлена.',{exact:false}).waitFor();
 await panel.getByRole('button',{name:'Применить изменения'}).click();await panel.getByText('Изменения применены и записаны в историю. Не удалось обновить экран',{exact:false}).waitFor();assert.deepEqual(tokens,['same-durable-token','same-durable-token']);
 await panel.getByRole('button',{name:'Обновить',exact:true}).click();await panel.getByText('Упаковка завершена. Доступны документы и отчёт.').waitFor();assert.equal(await panel.getByRole('button',{name:'Применить изменения'}).count(),0);assert.equal(await panel.getByRole('button',{name:'Скачать товары WB'}).count(),1);
 assert.deepEqual(errors,[]);fs.writeFileSync(root+'/browser-proof.json',JSON.stringify({passed:6,actualArtifact:true,errors,duplicateProtected:true}));console.log('browser6 passed');
 }finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);server.close();process.exitCode=1});




const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const [candidate,base,fallback,output]=process.argv.slice(2);
if(!candidate||!base||!fallback||!output)throw Error('Supply candidate web, base web, full fallback web and output directory');
fs.mkdirSync(output,{recursive:true});
const dirs=[candidate,base,fallback].map(p=>path.resolve(p));
const server=http.createServer((req,res)=>{
 const n=new URL(req.url,'http://local').pathname.slice(1)||'index.html';
 const targets=dirs.map(d=>path.resolve(d,n));if(targets.some((p,i)=>!p.startsWith(dirs[i]+path.sep)))return res.writeHead(400).end();
 const p=targets.find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());if(!p)return res.writeHead(404).end();
 res.setHeader('Content-Type',n.endsWith('.js')?'text/javascript':n.endsWith('.css')?'text/css':n.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(p));
});
const user={id:'fixture',name:'Тестовый оператор',roleCodes:['OWNER','ADMIN'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:'w',warehouseIds:['w'],writableWarehouseIds:['w']};
const client={id:'c',name:'ИП Лукин Илья Ильич',code:'CL-000001',status:'ACTIVE'};
const requests=[1,2,3].map(n=>({id:'r'+n,number:1550+n,clientId:'c',type:'OUTBOUND',status:'APPROVED',priority:'NORMAL',title:'FBS WB · Мой склад Новосибирск — 5 заказов',createdAt:'2026-10-08T06:00:00Z',updatedAt:'2026-10-08T06:00:00Z',desiredDate:'2026-10-09T06:00:00Z',client,items:[{id:'i'+n,requestId:'r'+n,skuId:'sku',quantity:23,name:'Зима Ностальджи темно-красный L / 48',sku:null}],files:[],packages:[],wbSupplyIds:['WB-GI-285301138'],createdBy:{id:'u',name:'WMS'}}));
async function navigate(page,name){await page.getByRole('button',{name:'☰ Меню',exact:true}).click();while(await page.locator('details:not([open]) > summary').count())await page.locator('details:not([open]) > summary').first().click();await page.getByRole('button',{name:new RegExp('^'+name+'(?:\\s|$)')}).first().click();}
// TEST: actual published component/React graph; mock only the API and physical printer.
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{for(const style of ['dark','light'])for(const width of [320,390,844]){
  const page=await browser.newPage({viewport:{width,height:width===844?390:844},hasTouch:true,isMobile:true});const errors=[],posts=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({user,style})=>{localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'fixture-only',tokenType:'Bearer',user}));localStorage.setItem('logoff-wms-ui-theme:'+user.id,'la_panthera');localStorage.setItem('logoff-wms-ui-style:la_panthera:'+user.id,style);},{user,style});
  await page.route('**/api/v1/**',async route=>{
   const p=new URL(route.request().url()).pathname,method=route.request().method();let data=[];
   if(method==='POST')posts.push({path:p,body:route.request().postDataJSON()});
   if(p.endsWith('/print/series/jobs'))data={id:'series:test',status:'queued',pages:3};
   else if(p.endsWith('/print/templates')&&method==='POST')data={id:'template'};
   else if(p.endsWith('/client-requests'))data=requests;
   else if(p.endsWith('/clients'))data=[client];
   else if(p.endsWith('/print/agent-stations'))data=[{id:'s',name:'Склад',printerName:'Тестовый принтер',lastSeenAt:new Date().toISOString()}];
   else if(p.endsWith('/box-overlaps'))data={errors:[],overlaps:[],requestsWithOverlapsCount:0,overlappingBoxesCount:0};
   else if(p.endsWith('/auth/me'))data=user;
   else if(p.endsWith('/users/workspaces'))data={users:[],workspaces:[]};
   else if(p.endsWith('/branches'))data=[{id:'w',code:'MSK',city:'Москва',name:'ФФ Москва',warehouseId:'w',isActive:true}];
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
  await navigate(page,'Заявки');await page.locator('.client-request-row').first().waitFor();
  const cards=await page.locator('.client-request-row').evaluateAll(es=>es.map(e=>({width:e.getBoundingClientRect().width,cells:[...e.querySelectorAll('td')].filter(x=>getComputedStyle(x).display!=='none').map(x=>({height:x.clientHeight,scroll:x.scrollHeight}))})));
  assert.equal(cards.length,3);for(const card of cards){assert.ok(card.width>=width-100,`narrow request card: ${card.width}/${width}`);for(const cell of card.cells)assert.ok(cell.scroll<=cell.height+2,`overlapping cell: ${JSON.stringify(cell)}`);}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page exceeds phone width');
  if(width===390){await page.locator('.client-request-row').first().screenshot({path:path.join(output,`request-${style}.png`)});await page.screenshot({path:path.join(output,`phone-${style}.png`)});}
  // A wide document must pan horizontally without clipping or expanding the page.
  const scroll=await page.evaluate(()=>{const e=document.createElement('div');e.className='online-execution-table-wrap';e.innerHTML='<div style="width:1400px;height:20px">wide document</div>';document.querySelector('.workspace-content').append(e);e.scrollLeft=120;const result={left:e.scrollLeft,touch:getComputedStyle(e).touchAction};e.remove();return result;});
  assert.equal(scroll.left,120);assert.equal(scroll.touch,'auto');
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.5});assert.ok(await page.evaluate(()=>visualViewport.scale>1));await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
  if(style==='dark'&&width===390){
   await navigate(page,'Печать');await page.getByRole('button',{name:/Наборы/}).click();
   await page.getByLabel('Текст перед номером',{exact:true}).fill('FFL_TEST_');await page.getByLabel('Количество номеров',{exact:true}).fill('3');await page.getByLabel(/^Куда печатать/).selectOption('AGENT:s');await page.getByRole('button',{name:/Напечатать 3/}).click();await page.getByText(/В агент печати отправлено 3/).waitFor();
   const series=posts.filter(p=>p.path.endsWith('/print/series/jobs'));assert.equal(series.length,1);assert.deepEqual(series[0].body.pages.map(p=>p.value),['FFL_TEST_001','FFL_TEST_002','FFL_TEST_003']);assert.ok(series[0].body.pages.every(p=>p.imageBase64.startsWith('iVBOR')));assert.equal(posts.filter(p=>p.path.includes('agent-custom-jobs')).length,0);
  }
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${style}/${width}: cards, horizontal pan, zoom, navigation`);
 }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

// TEST: ADMIN access, independent FBO availability and explicit receipt decision.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const root=process.argv[2],base=process.argv[3],entry=/src="\/assets\/([^"/]+\.js)"/.exec(fs.readFileSync(path.join(root,'index.html'),'utf8'))[1];
const panel=fs.readdirSync(path.join(root,'assets')).find(n=>n.endsWith('.js')&&fs.readFileSync(path.join(root,'assets',n),'utf8').includes('as AdministrationPanel')); 
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  let resolved=false,failReceipt=false,writes=0;
  await page.route('**/api/v1/**',route=>{
   const req=route.request(),path=new URL(req.url()).pathname;requests.push(path);
   const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(path.endsWith('/fbo-problems/capabilities'))return json({enabled:true});
   if(path.endsWith('/fbo-problems'))return json([]);
   if(path.endsWith('/receipt-barcode-review/summary'))return failReceipt?json({message:'Временно недоступно'},503):json({pending:resolved?0:1});
   if(path.endsWith('/receipt-barcode-review'))return failReceipt?json({message:'Временно недоступно'},503):json({pending:resolved?0:1,items:resolved?[]:[{id:'issue',deviceId:'TSD-1',status:'NEEDS_REVIEW',createdAt:'2026-10-07T08:12:24Z',client:{name:'ИП Лукин Илья Ильич'},payload:{clientId:'client',boxCode:'FFL_LKB0610_038',barcode:'18',firstBarcodeScan:'18',secondBarcodeScan:'18',quantity:'1',sourceDocument:'Приёмка 0610',actorName:'Приёмщик',barcodeReviewReason:'Необычная длина неизвестного ШК'}}]});
   if(path.endsWith('/issue/resolve')){writes++;assert.equal(req.postDataJSON().action,'REJECT');assert.equal(req.postDataJSON().comment,'Ошибочный скан количества вместо ШК');resolved=true;return json({message:'Отклонён'});}
   throw Error('Unexpected privileged request: '+path);
  });
  await page.route('http://localhost/assets/**',route=>{const n=new URL(route.request().url()).pathname.slice(1);const f=[path.join(root,n),path.join(base,n)].find(f=>fs.existsSync(f));if(!f)return route.abort();let body=fs.readFileSync(f);if(n==='assets/'+entry)body=body.toString()+'\nexport {x as TestReact,ws as TestDom,a2 as TestAccess};';return route.fulfill({contentType:n.endsWith('.js')?'application/javascript':'text/css',body});});
  await page.route('http://localhost/fixture',route=>route.fulfill({contentType:'text/html',body:'<div id="root" style="display:none"></div><div id="fixture-root"></div>'}));
  const mount=async()=>{await page.goto('http://localhost/fixture');await page.evaluate(async({entry,panel})=>{const m=await import('/assets/'+entry),p=await import('/assets/'+panel);const user={id:'admin',name:'Admin',roleCodes:['ADMIN'],permissionCodes:['stock:write'],activeWarehouseId:'w',administrationEnabled:false,workspaceVisibility:{administration:false},isDemo:false};if(!m.TestAccess(user,{id:'administration'}))throw Error('Admin menu missing');window.fixture={m,p,root:m.TestDom.createRoot(document.getElementById('fixture-root'))};window.fixture.root.render(m.TestReact.createElement(p.AdministrationPanel,{session:{accessToken:'fixture',user},onOpenWorkspace:()=>{}}));},{entry,panel});};
  await mount();
  await page.getByRole('button',{name:'Разобрать',exact:true}).click();
  const submit=page.getByRole('button',{name:'Подтвердить решение',exact:true});
  assert.equal(await submit.isDisabled(),true);
  await page.getByLabel('Действие').selectOption('REJECT');
  await page.getByLabel('Основание решения').fill('Ошибочный скан количества вместо ШК');
  assert.equal(await submit.isDisabled(),true);
  await page.getByRole('checkbox').check();
  if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
  await submit.click();await page.getByText('Обращений нет.',{exact:true}).waitFor();assert.equal(writes,1);
  failReceipt=true;await mount();
  const fbo=page.getByRole('button',{name:'Проблемы ФБО',exact:true});await fbo.waitFor();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Проблемы ФБО'&&!b.disabled));
  await fbo.click();await page.getByRole('heading',{name:'Проблемы FBO',exact:true}).waitFor();
  assert.deepEqual(errors,[]);assert.equal(requests.some(p=>p.includes('/administration/overview')),false);
  console.log('PASS: admin menu, receipt confirmation and FBO independence');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

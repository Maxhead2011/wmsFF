// TEST: ADMIN access, independent FBO availability and explicit receipt decision.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
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
  await page.goto((process.env.TEST_BASE_URL||'http://127.0.0.1:5197')+'/test/receipt-barcode.html');
  await page.getByRole('button',{name:'Разобрать',exact:true}).click();
  const submit=page.getByRole('button',{name:'Подтвердить решение',exact:true});
  assert.equal(await submit.isDisabled(),true);
  await page.getByLabel('Действие').selectOption('REJECT');
  await page.getByLabel('Основание решения').fill('Ошибочный скан количества вместо ШК');
  assert.equal(await submit.isDisabled(),true);
  await page.getByRole('checkbox').check();
  if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
  await submit.click();await page.getByText('Обращений нет.',{exact:true}).waitFor();assert.equal(writes,1);
  failReceipt=true;await page.reload();
  const fbo=page.getByRole('button',{name:'Проблемы ФБО',exact:true});await fbo.waitFor();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Проблемы ФБО'&&!b.disabled));
  await fbo.click();await page.getByRole('heading',{name:'Проблемы FBO',exact:true}).waitFor();
  assert.deepEqual(errors,[]);assert.equal(requests.some(p=>p.includes('/administration/overview')),false);
  console.log('PASS: admin menu, receipt confirmation and FBO independence');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

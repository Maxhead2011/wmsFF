// TEST: actual list → modal → preview → confirmed inbound apply, with error/stale response coverage.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let applies=0,previews=0,lists=0,failedPreview=false,failedApply=false,same=false,delay=false,release,delayApply=false,releaseApply,applied=false;
  const makePreview=()=>({token:'review-'+previews,needed:256,after:same?256:252,rows:[{direction:'Москва',skuId:'s',name:'Платье',barcode:'123',before:4,after:same?4:1,packed:0},{direction:'Москва',skuId:'s2',name:'Костюм',barcode:'456',before:6,after:same?6:5,packed:0}]});
  const row={id:'r',number:2655,title:'ФБО Ozon · test',clientName:'Тестовый клиент',clientCode:'CL-TEST',status:'SUBMITTED',phase:'NOT_STARTED',quantity:256,directions:1,destinationCity:'Москва',desiredDate:null};
  await page.route('**/api/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;
   const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   if(path.endsWith('/clients'))return json([]);
   if(path.endsWith('/capability'))return json({enabled:false});
   if(path.endsWith('/ozon-fbo-import/requests')){lists++;return json([{...row,quantity:applied?252:256,...(url.searchParams.get('view')==='completed'?{status:'DONE',phase:'COMPLETED'}:{})}]);}
   if(path.endsWith('/sync-preview')){previews++;const snapshot=makePreview();if(delay)await new Promise(resolve=>release=resolve);return json(failedPreview?{message:'Ozon временно недоступен'}:snapshot,failedPreview?503:200);}
   if(path.endsWith('/sync-apply')){applies++;assert.deepEqual(req.postDataJSON(),{token:'review-'+previews,confirm:true});if(delayApply)await new Promise(resolve=>releaseApply=resolve);if(failedApply)return json({message:'Состав изменился. Повторите сверку.'},409);applied=true;return json(makePreview());}
   throw Error('Unexpected request (including outbound mutation): '+path);
  });
  const url=(process.env.TEST_BASE_URL||'http://127.0.0.1:5199')+'/test/ozon-composition-sync.html';
  await page.goto(url);
  const open=()=>page.getByRole('button',{name:'Обновить состав из Ozon',exact:true}).click();
  const modal=()=>page.getByRole('dialog',{name:'Обновить состав из Ozon · №2655'});
  await open();await modal().getByText('Изменений количества:',{exact:false}).waitFor();
  if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH});
  assert.equal(applies,0);assert.equal(await modal().getByRole('button',{name:'Применить в WMS и Ozon'}).count(),0);
  const apply=()=>modal().getByRole('button',{name:'Применить состав в ВМС',exact:true});
  assert(await apply().isDisabled());
  await modal().getByRole('checkbox').check();assert(await apply().isEnabled());
  delayApply=true;await apply().click();await page.waitForFunction(()=>document.body.textContent.includes('Обновляю заявку…'));
  assert.equal(await modal().getByRole('button',{name:'Закрыть',exact:true}).count(),0);
  assert(await modal().getByRole('button',{name:'Обновляю заявку…'}).isDisabled());
  releaseApply();delayApply=false;await page.getByText('Состав заявки №2655 обновлён из Ozon.',{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
  assert.equal(applies,1);assert(lists>=2);assert(await page.getByText(/252 шт/).count());
  // Closing a slow read cannot resurrect its modal or apply anything.
  delay=true;await open();await modal().getByText('Сверяю состав с Ozon…').waitFor();
  await page.waitForTimeout(100);await modal().getByRole('button',{name:'Закрыть',exact:true}).click();release();delay=false;
  await page.waitForTimeout(150);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(applies,1);
  // Preview failure is actionable; retry is read-only and equal quantities still require explicit confirmation for metadata refresh.
  failedPreview=true;await open();await modal().getByRole('alert').getByText('Ozon временно недоступен').waitFor();assert.equal(await apply().count(),0);
  failedPreview=false;same=true;await modal().getByRole('button',{name:'Повторить сверку'}).click();await modal().getByText('Количества совпадают с Ozon. Можно обновить данные привязанной поставки без изменения количества.').waitFor();assert(await apply().isDisabled());assert.equal(applies,1);
  same=false;await modal().getByRole('button',{name:'Повторить сверку'}).click();await modal().getByRole('checkbox').check();
  failedApply=true;await apply().click();await modal().getByRole('alert').getByText('Состав изменился. Повторите сверку.').waitFor();assert.equal(await apply().count(),0);
  failedApply=false;await modal().getByRole('button',{name:'Повторить сверку'}).click();await modal().getByRole('checkbox').waitFor();assert(await apply().isDisabled());assert(!(await modal().getByRole('checkbox').isChecked()));
  // Mobile retains the modal and readable comparison; archive/read-only have no sync button.
  await page.setViewportSize({width:390,height:844});const bounds=await modal().boundingBox();assert(bounds&&bounds.x>=0&&bounds.width<=390);
  await modal().getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Завершённые',exact:true}).click();await page.getByText('Сдано',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Обновить состав из Ozon',exact:true}).count(),0);
  await page.goto(url+'?readonly');await page.getByText('№002655',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Обновить состав из Ozon',exact:true}).count(),0);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:8,applies,previews,lists,source:'synthetic browser; no production writes'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

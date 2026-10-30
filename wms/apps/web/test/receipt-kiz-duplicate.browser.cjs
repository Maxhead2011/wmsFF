// TEST: a duplicate must keep the scan, show its original location and create one explicit review.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
 try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let reviews=0,writes=0;
  const kiz='010464068426237821AbCdEf1234567';
  await page.route('**/api/v1/**',route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(path.endsWith('/warehouse/receipt-channels'))return json({rows:[],enabled:false});
   if(path.endsWith('/warehouse/online-receipts'))return json({clientId:'client',generatedAt:'2026-10-29T12:00:00Z',receipts:[],currentBatchDate:null,boxes:[{key:'box',boxId:'box',boxCode:'FFL_CURRENT',sourceDocument:'receipt',status:'receiving',totalQuantity:0,kizCount:0,items:[],currentBalances:[],kizValues:[]}]});
   if(path.endsWith('/skus'))return json([]);
   if(path.endsWith('/warehouse/online-receipts/items')){writes++;assert.equal(request.postDataJSON().kiz,kiz);return json({code:'KIZ_DUPLICATE',message:'ОТЛОЖИТЕ ТОВАР',duplicateInfo:{identity:kiz,firstBoxCode:'FFL_ORIGINAL',currentBoxCode:'FFL_STORED',productName:'Костюм',firstReceivedAt:'2026-09-01T07:30:00Z',currentStatus:'AVAILABLE'}},409);}
   if(path.endsWith('/tsd/receipts/kiz-review')){reviews++;const b=request.postDataJSON();assert.equal(b.kiz,kiz);assert.equal(b.clientId,'client');assert(b.operationKey);return json({id:'case',status:'OPEN',message:'Передано на проверку'});}
   throw Error('Unexpected request '+path);
  });
  await page.goto((process.env.TEST_BASE_URL||'http://127.0.0.1:5198')+'/test/receipt-kiz-duplicate.html');
  await page.getByPlaceholder('Начните вводить ШК или товар').fill('2051234567890');
  await page.getByPlaceholder('Если есть').fill(kiz);await page.getByRole('button',{name:'Добавить',exact:true}).click();
  const stop=page.getByRole('alert');await stop.waitFor();
  assert((await stop.innerText()).includes('ОТЛОЖИТЕ ТОВАР'));assert((await stop.innerText()).includes('FFL_ORIGINAL'));
  assert.equal(await page.getByPlaceholder('Если есть').inputValue(),kiz);
  assert.equal(await page.getByPlaceholder('Начните вводить ШК или товар').inputValue(),'2051234567890');
  assert.equal(await page.getByRole('button',{name:'Добавить',exact:true}).isDisabled(),true);
  assert.equal(await page.getByPlaceholder('Если есть').isDisabled(),true);
  assert.equal(reviews,0);await page.getByRole('button',{name:'Передать на проверку',exact:true}).click();
  await stop.getByText('Передано на проверку.',{exact:true}).waitFor();assert.equal(reviews,1);assert.equal(writes,1);
  await page.getByRole('button',{name:'Сканировать другой товар',exact:true}).click();
  assert.equal(await page.getByPlaceholder('Если есть').inputValue(),'');assert.equal(await page.getByRole('alert').count(),0);
  assert.equal(await page.getByRole('button',{name:'Добавить',exact:true}).isDisabled(),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:10,syntheticApi:true}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

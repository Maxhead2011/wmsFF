// TEST: real controls, remote-only drift, two bases, errors and uncertain writes; no real marketplace writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),fs=require('fs');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let starts=0,inbound=0,op=null,packed=false,failed=false,previews=0;
 await page.route('**/api/v1/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname,body=req.postDataJSON();const json=(v,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(v)});
  if(p.endsWith('/ozon-adjustment'))return json({operation:op});
  if(p.endsWith('/sync-preview'))return json({token:'inbound',needed:182,after:186,rows:[{direction:'Москва',skuId:'s',name:'Платье',barcode:'123',before:182,after:186,packed:182}]});
  if(p.endsWith('/sync-apply')){inbound++;assert.equal(body.confirm,true);return json({applied:true});}
  if(p.endsWith('/preview')){previews++;assert(['AVAILABLE','PICKED'].includes(body.mode));return json({token:'outbound',mode:body.mode,physicalBasis:packed?'PACKED':body.mode,needed:182,after:182,changes:true,rows:[{direction:'Москва',skuId:'s',barcode:'123',before:182,packed:182,after:182}],lines:[{skuId:'s',name:'Платье'}],comparison:[{direction:'Москва',barcode:'123',before:182,remote:186,after:182}]});}
  if(p.endsWith('/start')){starts++;assert.equal(body.confirm,true);assert.equal(body.token,'outbound');if(failed)return json({message:'Состав изменился. Повторите предпросмотр.'},409);op={id:'op',state:'RUNNING',operations:[{supplyId:'42',state:'UNKNOWN'}]};return route.abort('failed');}
  if(p.endsWith('/resume'))return json({operation:op});return json({});
 });
 await page.goto(process.env.FIXTURE_URL||'http://127.0.0.1:5187/test/ozon-physical.html');
 const adjust=page.getByRole('button',{name:'Скорректировать Ozon по факту',exact:true}),apply=()=>page.getByRole('button',{name:'Применить в ВМС и Ozon',exact:true});
 await adjust.click();assert.equal(starts,0);assert(await apply().isDisabled());await page.getByRole('button',{name:'По отобранному',exact:true}).click();assert(await page.getByRole('button',{name:'По отобранному',exact:true}).getAttribute('aria-pressed')==='true');assert.equal(previews,2);
 await page.getByRole('checkbox').check();failed=true;await apply().click();await page.getByRole('alert').getByText('Состав изменился. Повторите предпросмотр.').waitFor();assert.equal(await apply().count(),0);
 failed=false;packed=true;await adjust.click();await page.getByText('По упакованному составу коробов').waitFor();assert(await apply().isDisabled());assert.equal(await page.getByRole('button',{name:'По наличию',exact:true}).count(),0);assert(await page.getByRole('spinbutton').isDisabled());
 await page.mouse.move(0,0);await page.waitForTimeout(200);
 const css=await adjust.evaluate(el=>({radius:getComputedStyle(el).borderRadius,bg:getComputedStyle(el).backgroundColor}));assert.equal(css.radius,'12px');assert.equal(css.bg,'rgb(238, 231, 247)');
 if(process.env.SHOT)await page.screenshot({path:process.env.SHOT});
 await page.getByRole('button',{name:'Обновить состав из Ozon',exact:true}).click();assert.equal(await apply().count(),0);assert(await page.getByRole('button',{name:'Обновить заявку из Ozon',exact:true}).isDisabled());await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Обновить заявку из Ozon',exact:true}).click();assert.equal(inbound,1);
 await adjust.click();await page.getByRole('checkbox').check();await apply().click();await page.getByText('Ответ не подтверждён',{exact:false}).waitFor();assert.equal(await adjust.count(),0);await page.getByRole('button',{name:'Проверить результат / продолжить',exact:true}).click();assert.equal(starts,2);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 const proof={passed:10,previews,starts,inbound,errors,synthetic:true};if(process.env.PROOF)fs.writeFileSync(process.env.PROOF,JSON.stringify(proof));console.log(JSON.stringify(proof));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

// TEST: actual browser font rendering, independent counter, rotated text, PDF fit and no automatic print.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const fs=require('fs'),path=require('path');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
 try{
  const context=await browser.newContext();await context.addInitScript(()=>{window.print=()=>{window.__printed=true;};});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/print/templates',r=>r.fulfill({json:[{id:'std',name:'Обычная',isActive:true,widthMm:58,heightMm:40}]}));
  const jobs=[];
  await page.route('**/api/v1/clients',r=>r.fulfill({json:[{id:'c',code:'CL-TEST',name:'Test'}]}));
  await page.route('**/api/v1/print/series/stations',r=>r.fulfill({json:[{id:'s',name:'Agent',printerName:'Printer'}]}));
  await page.route('**/api/v1/print/series/formats',r=>r.fulfill({json:[{id:'s',name:'Agent',printerName:'Printer',labelWidthMm:58,labelHeightMm:40}]}));
  await page.route('**/api/v1/print/series/jobs',r=>{jobs.push(r.request().postDataJSON());return r.fulfill({status:jobs.length===1?503:200,json:jobs.length===1?{message:'Temporary network error'}:{id:'synthetic-job',status:'queued',pages:jobs.at(-1).pages.length}});});
  // TEST: the real queue route is intercepted; this never reaches a physical printer.
  async function testAgent(expected,retry){
    const before=jobs.length;await page.getByRole('button',{name:'Печать через агент',exact:true}).click();
    const d=page.getByRole('dialog',{name:'Печать через агент'});
    await d.getByLabel('Клиент для печати').selectOption('c');await d.getByLabel('Принтер агента').selectOption('s');assert.equal(jobs.length,before);
    await d.getByRole('button',{name:'Отправить на печать'}).click();
    if(retry)await d.getByRole('button',{name:'Повторить то же задание'}).click();
    await d.getByRole('button',{name:'Закрыть',exact:true}).click();assert.equal(jobs.at(-1).pages.length,expected);
    if(retry)assert.deepEqual(jobs[0],jobs[1]);
  }
  const user={id:'free-label-test',name:'Test',email:'test@example.invalid',roleCodes:['OWNER','ADMIN'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:'w',warehouseIds:['w'],writableWarehouseIds:['w']};
  await page.addInitScript(user=>{localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'synthetic',user}));},user);
  await page.route('**/*',async route=>{const req=route.request(),p=new URL(req.url()).pathname;
   if(['/api/v1/clients','/api/v1/print/series/stations','/api/v1/print/series/formats','/api/v1/print/series/jobs'].includes(p))return route.fallback();if(p.startsWith('/api/')){assert.equal(req.method(),'GET');let body=[];if(p.endsWith('/auth/me'))body=user;else if(p.endsWith('/branches'))body=[{id:'w',name:'Test',isActive:true}];else if(p.endsWith('/print/templates'))body=[{id:'std',name:'Standard',isActive:true,widthMm:58,heightMm:40}];return route.fulfill({json:body});}
   const file=path.join(process.env.LABEL_CANDIDATE||'',p==='/'?'index.html':p);if(process.env.LABEL_CANDIDATE&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({body:fs.readFileSync(file),contentType:/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});return route.continue();});
  await page.goto('https://wms.logoff.pro/',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'\u041f\u0435\u0447\u0430\u0442\u044c',exact:true}).first().click();
  await page.getByRole('button',{name:/\u0421\u0432\u043e\u0431\u043e\u0434\u043d\u044b\u0439 \u0432\u0432\u043e\u0434/}).click();

  await page.getByAltText('Предпросмотр этикетки').waitFor();
  await page.getByLabel('Стандартный размер этикетки',{exact:true}).selectOption('std');
  await page.getByRole('button',{name:'Счётчик',exact:true}).click();
  await page.getByLabel('Начальное значение',{exact:true}).fill('8');
  await page.getByLabel('Шаг',{exact:true}).fill('2');
  await page.getByLabel('Количество этикеток',{exact:true}).fill('3');
  await page.getByLabel('Предпросмотр номера',{exact:true}).fill('3');
  await page.getByLabel('Направление',{exact:true}).selectOption('180');
  await page.waitForTimeout(400);await page.getByAltText('Предпросмотр этикетки').waitFor();
  const pending=context.waitForEvent('page');await page.getByRole('button',{name:'Предпросмотр и выбор принтера',exact:true}).click();const print=await pending;
  await print.getByRole('button',{name:'Выбрать принтер и печатать'}).waitFor();await print.waitForFunction(()=>document.images.length===3&&[...document.images].every(i=>i.complete),null,{timeout:8000}).catch(async e=>{console.log('PRINT DEBUG',await print.locator('body').innerText(),await print.locator('img').count());throw e;});
  assert.equal(await print.evaluate(()=>window.__printed),undefined);await print.close();await testAgent(3,true);
  await page.getByRole('button',{name:'Печать из файла',exact:true}).click();
  await page.getByLabel('Выберите файл',{exact:true}).setInputFiles(process.env.PDF_FIXTURE);
  await page.getByAltText('Файл в выбранном размере этикетки').waitFor({timeout:30000});
  await page.getByLabel('Страницы (пусто — все)',{exact:true}).fill('1,3');
  await page.waitForTimeout(300);
  const next=context.waitForEvent('page');await page.getByRole('button',{name:'Предпросмотр и выбор принтера',exact:true}).click();const output=await next;
  await output.waitForFunction(()=>document.images.length===2&&[...document.images].every(i=>i.complete));assert.equal(await output.evaluate(()=>window.__printed),undefined);
  await output.pdf({path:process.env.PDF_OUTPUT,preferCSSPageSize:true});await output.close();await testAgent(2,false);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:process.env.SCREENSHOT,fullPage:true});assert(await page.evaluate(()=>document.querySelector('.free-label').scrollWidth<=document.querySelector('.free-label').clientWidth+1));
  assert.deepEqual(errors,[]);console.log('PASS: 3 counter labels, 2 selected PDF pages, no print invocation, mobile layout');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

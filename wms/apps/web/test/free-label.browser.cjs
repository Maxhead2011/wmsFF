// TEST: actual browser font rendering, independent counter, rotated text, PDF fit and no automatic print.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
 try{
  const context=await browser.newContext();await context.addInitScript(()=>{window.print=()=>{window.__printed=true;};});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/print/templates',r=>r.fulfill({json:[{id:'std',name:'Обычная',isActive:true,widthMm:58,heightMm:40}]}));
  const jobs=[];
  await page.route('**/api/v1/clients',r=>r.fulfill({json:[{id:'c',code:'CL-TEST',name:'Test'}]}));
  await page.route('**/api/v1/print/series/stations',r=>r.fulfill({json:[{id:'s',name:'Agent',printerName:'Printer'},{id:'oz',name:'ОЗОН',printerName:'TSC TE200'}]}));
  await page.route('**/api/v1/print/series/formats',r=>r.fulfill({json:[{id:'s',name:'Agent',printerName:'Printer',labelWidthMm:58,labelHeightMm:40},{id:'oz',name:'ОЗОН',printerName:'TSC TE200',labelWidthMm:70,labelHeightMm:120}]}));
  await page.route('**/api/v1/print/series/jobs',r=>{jobs.push(r.request().postDataJSON());return r.fulfill({status:jobs.length===1?503:200,json:jobs.length===1?{message:'Temporary network error'}:{id:'synthetic-job',status:'queued',pages:jobs.at(-1).pages.length}});});
  // TEST: the real queue route is intercepted; this never reaches a physical printer.
  async function testAgent(expected,retry,stationId='s'){
    const before=jobs.length;await page.getByRole('button',{name:'Печать через агент',exact:true}).click();
    const d=page.getByRole('dialog',{name:'Печать через агент'});
    await d.getByLabel('Клиент для печати').selectOption('c');await d.getByLabel('Принтер агента').selectOption(stationId);assert.equal(jobs.length,before);
    await d.getByRole('button',{name:'Отправить на печать'}).click();
    if(retry)await d.getByRole('button',{name:'Повторить то же задание'}).click();
    await d.getByRole('button',{name:'Закрыть',exact:true}).click();assert.equal(jobs.at(-1).pages.length,expected);
    if(retry)assert.deepEqual(jobs[0],jobs[1]);
  }
  await page.goto('http://127.0.0.1:5194/test/free-label.html');
  await page.getByAltText('Предпросмотр этикетки').waitFor();
  await page.getByLabel('Стандартный размер этикетки',{exact:true}).selectOption('std');
  // TEST: delete the selected second field before scrolling through its settings.
  await page.getByRole('button',{name:'Текст',exact:true}).click();
  assert.equal(await page.locator('.free-label__fields button').count(),2);
  const remove=page.getByRole('button',{name:'Удалить выбранное поле',exact:true});
  assert(await remove.evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('.free-label textarea'))&Node.DOCUMENT_POSITION_FOLLOWING)));
  await remove.click();assert.equal(await page.locator('.free-label__fields button').count(),1);
  assert.equal(await page.locator('.free-label textarea').inputValue(),'ФБО');
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
  // TEST: printer-only 70x120 media appears and enables the second Ozon agent.
  await page.getByLabel('Стандартный размер этикетки',{exact:true}).selectOption('station:oz');
  await page.waitForTimeout(400);await testAgent(2,false,'oz');
  assert.equal(jobs.at(-1).widthMm,70);assert.equal(jobs.at(-1).heightMm,120);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:process.env.SCREENSHOT,fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);console.log('PASS: 3 counter labels, 2 selected PDF pages, no print invocation, mobile layout');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

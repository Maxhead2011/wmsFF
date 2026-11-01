const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({channel:'msedge'});
  try {
    const page = await browser.newPage();
    await page.goto('https://wms.logoff.pro/',{waitUntil:'domcontentloaded'});
    if (!process.env.PUBLIC_GRID) await page.addStyleTag({content:fs.readFileSync('wms/apps/web/src/components/client-requests/request-action-menus.css','utf8')});
    await page.evaluate(() => {
      const el=document.createElement('div'); el.id='grid-test'; el.className='client-request-table__warehouse-cell';
      el.style.cssText='position:fixed;inset:20px auto auto 20px;background:white;width:320px;z-index:999999';
      document.body.append(el);
      el.innerHTML='<div class="client-request-actions"><div class="request-action-menu"><button title="Открыть сборку"><span>Онлайн</span></button><button class="client-request-action-button--fbs-box-search"><span>Остатки и короба</span></button><details class="request-action-menu__group"><summary>Документы</summary><button>Файл</button></details><details class="request-action-menu__group"><summary>Ещё</summary></details></div></div>';
    });
    const buttons=page.locator('#grid-test .request-action-menu > button, #grid-test summary');
    const boxes=await buttons.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}));
    assert.equal(boxes.length,4);assert.equal(boxes[0][0],boxes[2][0]);assert.equal(boxes[1][1],boxes[0][1]);assert(boxes[1][0]>boxes[0][0]);assert(boxes[2][1]>boxes[0][1]);
    for(const b of boxes){assert.equal(b[2],124);assert.equal(b[3],53)}
    const online=buttons.first();assert.equal(await online.evaluate(n=>getComputedStyle(n,'::before').animationName),'request-online-pulse');
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await online.evaluate(n=>getComputedStyle(n,'::before').animationName),'none');
    await buttons.nth(2).click();assert.equal(Math.round((await buttons.nth(2).boundingBox()).width),257);
    const note = await page.evaluate(() => {
      document.documentElement.dataset.uiTheme='modern';document.documentElement.dataset.uiVariant='la_panthera';const t=document.createElement('table');t.className='client-request-table';t.style.cssText='width:150px;table-layout:fixed';
      t.innerHTML='<tbody><tr><td><div class="client-request-due-status"><span class="client-request-status-comment"></span></div></td></tr></tbody>';
      document.body.append(t);t.querySelector('.client-request-due-status').style.cssText='display:grid;width:135px';const n=t.querySelector('span');n.textContent='Заявка упакована и ожидает сдачи на склад маркетплейса. '.repeat(4);
      return { height:n.clientHeight,scroll:n.scrollHeight,width:n.clientWidth,scrollWidth:n.scrollWidth };
    });
    console.log(note);assert(note.height>50 && note.scroll<=note.height+1 && note.scrollWidth<=note.width+1);
    console.log('PASS grid sizes, positions, expanded menu, online animation and reduced motion');
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

// TEST: the complete published CSS cascade, not an isolated stylesheet.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),candidate=process.argv.includes('--candidate');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let passed=0;
try{const page=await browser.newPage();
await page.goto('https://wms.logoff.pro/',{waitUntil:'networkidle'});
await page.evaluate(()=>{document.body.innerHTML='<main class="app-layout"><table class="client-request-table"><tbody><tr><td class="client-request-table__warehouse-cell"><div class="client-request-actions"><div class="request-action-menu"><button class="document-open-button--online">Онлайн</button><button class="client-request-action-button--refresh-instruction">Обновить план</button><details class="request-action-menu__group"><summary>Документы</summary><div class="request-action-menu__items"><button>Скачать файл</button></div></details><details class="request-action-menu__group"><summary>Ещё</summary><div class="request-action-menu__items"><button>История</button></div></details></div></div></td></tr></tbody></table><div role="group" aria-label="Режим FBO Ozon" style="display:flex;gap:12px;margin-bottom:16px"><button type="button" aria-pressed="true">Файл клиента — единая сборка</button><button type="button" aria-pressed="false">План через API Ozon</button></div></main>';document.querySelectorAll('[aria-label="Режим FBO Ozon"] button').forEach(b=>b.onclick=()=>{for(const x of b.parentElement.children)x.setAttribute('aria-pressed',String(x===b))});document.documentElement.dataset.uiTheme='modern';document.documentElement.dataset.uiVariant='la_panthera';});
if(candidate)await page.addStyleTag({content:fs.readFileSync('apps/web/src/components/layout/compact-operational-controls.css','utf8')});
for(const width of [1440,1920,390])for(const font of [16,20])for(const style of ['light','dark']){
 await page.setViewportSize({width,height:900});await page.evaluate(({font,style,width})=>{document.documentElement.dataset.uiStyle=style;document.body.style.fontSize=font+'px';document.querySelector('main').style.cssText='display:block;padding:20px;box-sizing:border-box;width:100%';document.querySelector('table').style.cssText='width:290px;table-layout:fixed';document.querySelector('td').style.width='290px';document.querySelector('.client-request-actions').style.fontSize=font+'px'}, {font,style,width});
 const boxes=await page.locator('.request-action-menu > button, .request-action-menu > details > summary').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,overflow:n.scrollWidth>n.clientWidth+1}}));
 assert.equal(boxes.length,4);assert(boxes.every(b=>b.h<49&&!b.overflow),JSON.stringify({width,font,style,boxes}));
 if(width>700){assert.equal(boxes[0].y,boxes[1].y);assert(boxes[1].x>boxes[0].x)}
 const summary=page.locator('summary').first();await summary.click();assert(await summary.evaluate(n=>n.parentElement.open));assert(await page.getByRole('button',{name:'Скачать файл',exact:true}).isVisible());await summary.click();
 const group=page.getByRole('group',{name:'Режим FBO Ozon'}),buttons=group.getByRole('button');await buttons.nth(1).click();assert.equal(await buttons.nth(1).getAttribute('aria-pressed'),'true');
 assert.notEqual(await buttons.nth(0).evaluate(n=>getComputedStyle(n).backgroundColor),await buttons.nth(1).evaluate(n=>getComputedStyle(n).backgroundColor));
 assert(await group.evaluate(n=>n.scrollWidth<=n.clientWidth+1));passed++;
}
await page.setViewportSize({width:1440,height:700});await page.evaluate(()=>document.documentElement.dataset.uiStyle='light');await page.screenshot({path:root+'/controls.png'});
fs.writeFileSync(root+(candidate?'/candidate-browser.json':'/public-browser.json'),JSON.stringify({passed}));console.log('PASS',passed);
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

// TEST: the complete published CSS cascade, not an isolated stylesheet.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(process.argv[2]);fs.mkdirSync(root,{recursive:true});
// FIX: a failed retry must never leave a previous successful proof.
fs.rmSync(path.join(root,'controls-check.json'),{force:true});
const source=process.argv.includes('--source');
const sourceRoot=path.resolve(process.env.CONTROLS_SOURCE_ROOT || path.join(__dirname,'../apps/web/src'));
function readCss(file,seen=new Set()) {
 assert(!seen.has(file),'cyclic CSS import'); const next=new Set(seen).add(file);
 return fs.readFileSync(file,'utf8').replace(/@import\s+['"]([^'"]+)['"];?/g,(_,name)=>readCss(path.resolve(path.dirname(file),name),next));
}

(async()=>{const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});let passed=0;
try{const page=await browser.newPage({ignoreHTTPSErrors:!!process.env.PUBLIC_URL});
if(source){
 const entry=fs.readFileSync(path.join(sourceRoot,'lib/marketplaceWorkspace.ts'),'utf8');
 assert(entry.includes("if (workspaceEnabled()) void import('../components/layout/marketplace-surfaces.css')"),'workspace stylesheet import missing');
 const files=['components/client-requests/client-requests.css','components/layout/la-panthera-theme.css','components/layout/la-panthera-light.css','components/layout/marketplace-surfaces.css','components/client-requests/request-action-menus.css'];
 await page.setContent('<html><head></head><body></body></html>');
 for(const file of files) await page.addStyleTag({content:readCss(path.join(sourceRoot,file))});
}else{
 assert(process.env.PUBLIC_URL,'PUBLIC_URL must point to the exact candidate or published site');
 await page.goto(process.env.PUBLIC_URL,{waitUntil:'networkidle'});
}

await page.evaluate(()=>{document.body.innerHTML='<main class="app-layout"><table class="client-request-table"><tbody><tr><td class="client-request-table__warehouse-cell"><div class="client-request-actions"><div class="request-action-menu"><button class="document-open-button--online">Онлайн</button><button class="client-request-action-button--refresh-instruction">Обновить план</button><details class="request-action-menu__group"><summary>Документы</summary><div class="request-action-menu__items"><button>Скачать файл</button></div></details><details class="request-action-menu__group"><summary>Ещё</summary><div class="request-action-menu__items"><button>История</button></div></details></div></div></td></tr></tbody></table><div role="group" aria-label="Режим FBO Ozon" style="display:flex;gap:12px;margin-bottom:16px"><button type="button" aria-pressed="true">Файл клиента — единая сборка</button><button type="button" aria-pressed="false">План через API Ozon</button></div></main>';document.querySelectorAll('[aria-label="Режим FBO Ozon"] button').forEach(b=>b.onclick=()=>{for(const x of b.parentElement.children)x.setAttribute('aria-pressed',String(x===b))});document.documentElement.dataset.uiTheme='modern';document.documentElement.dataset.uiVariant='la_panthera';});
for(const width of [1440,1920,390])for(const font of [16,20])for(const style of ['light','dark'])for(const mode of ['fbo','fbs']){
 await page.setViewportSize({width,height:900});await page.locator('.request-action-menu > button').nth(1).evaluate((n,mode)=>{n.className=mode==='fbs'?'client-request-action-button--fbs-box-search':'client-request-action-button--refresh-instruction';n.textContent=mode==='fbs'?'Остатки и короба':'Обновить план'},mode);await page.evaluate(({font,style,width})=>{document.documentElement.dataset.uiStyle=style;document.body.style.fontSize=font+'px';document.querySelector('main').style.cssText='display:block;padding:20px;box-sizing:border-box;width:100%';document.querySelector('table').style.cssText='width:290px;table-layout:fixed';document.querySelector('td').style.width='290px';document.querySelector('.client-request-actions').style.fontSize=font+'px'}, {font,style,width});
 const boxes=await page.locator('.request-action-menu > button, .request-action-menu > details > summary').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,overflow:n.scrollWidth>n.clientWidth+1}}));
 assert.equal(boxes.length,4);assert(boxes.every(b=>b.h<49&&!b.overflow),JSON.stringify({width,font,style,boxes}));
 {assert.equal(boxes[0].y,boxes[1].y);assert(boxes[1].x>boxes[0].x);
 assert.equal(boxes[2].y,boxes[3].y);assert(boxes[2].y>boxes[0].y);
 assert.equal(boxes[0].x,boxes[2].x);assert.equal(boxes[1].x,boxes[3].x);} // TEST: both rows, not just the first pair.
 const summary=page.locator('summary').first();await summary.click();assert(await summary.evaluate(n=>n.parentElement.open));assert(await page.getByRole('button',{name:'Скачать файл',exact:true}).isVisible());await summary.click();
 const group=page.getByRole('group',{name:'Режим FBO Ozon'}),buttons=group.getByRole('button');await buttons.nth(0).click();await buttons.nth(1).click();assert.equal(await buttons.nth(1).getAttribute('aria-pressed'),'true');
 assert.notEqual(await buttons.nth(0).evaluate(n=>getComputedStyle(n).backgroundColor),await buttons.nth(1).evaluate(n=>getComputedStyle(n).backgroundColor));
 assert.equal(await buttons.nth(1).evaluate(n=>getComputedStyle(n).borderRadius),'9px');
 assert(await group.evaluate(n=>n.scrollWidth<=n.clientWidth+1));passed++;
}
await page.setViewportSize({width:1440,height:700});await page.evaluate(()=>document.documentElement.dataset.uiStyle='light');await page.screenshot({path:root+'/controls.png'});
fs.writeFileSync(root+'/controls-check.json',JSON.stringify({passed,mode:source?'source':'served-artifact',checkedAt:new Date().toISOString()}));console.log('PASS',passed);
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

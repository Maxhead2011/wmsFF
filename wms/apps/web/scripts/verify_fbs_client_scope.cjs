// TEST: the chosen client must span the header rather than occupy its narrow icon column.
// Run with Playwright in NODE_PATH; BROWSER_EXECUTABLE can select installed Chromium.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
try{for(const width of [375,724,1280]){const page=await browser.newPage({viewport:{width,height:700}});
await page.setContent('<meta charset="utf-8"><div class="app-layout" data-ui-theme="modern" style="display:block;min-height:0"><section class="fbs-panel"><header class="fbs-panel__hero"><div class="fbs-panel__hero-icon">WB</div><div><button>Назад к выбору FBS</button><h2>FBS Wildberries</h2><p>Заказы WB, складские остатки, короба, грузоместа, поставки и пропуска.</p></div><span class="fbs-panel__scope">CL-000001 · ИП Лукин Илья Ильич</span></header></section></div>');
await page.addStyleTag({content:fs.readFileSync(path.join(root,'src/components/fbs/fbs.css'),'utf8')});
await page.addStyleTag({content:fs.readFileSync(path.join(root,'src/styles.css'),'utf8')});
const geometry=await page.locator('.fbs-panel__scope').evaluate(el=>{const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return {width:r.width,height:r.height,right:r.right,parentRight:p.right,overflow:el.scrollWidth>el.clientWidth+1,column:getComputedStyle(el).gridColumn};});
assert(geometry.width>180,JSON.stringify({width,geometry}));assert(geometry.height<75,JSON.stringify({width,geometry}));assert(!geometry.overflow&&geometry.right<=geometry.parentRight,JSON.stringify({width,geometry}));
if(process.argv[2]){fs.mkdirSync(process.argv[2],{recursive:true});await page.locator('.fbs-panel__hero').screenshot({path:path.join(process.argv[2],`client-${width}.png`)});}await page.close();}
console.log('PASS: client header at 375, 724 and 1280 px');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

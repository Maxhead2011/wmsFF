const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..');
const css=process.env.TURNOVER_TEST_CSS?fs.readFileSync(process.env.TURNOVER_TEST_CSS,'utf8'):fs.readFileSync(path.join(root,'src/components/turnover/turnover.css'),'utf8');
const source=fs.readFileSync(path.join(root,'src/components/turnover/TurnoverPanel.tsx'),'utf8');
const article='Костюм_лининг_какспандекс_серый_очень_длинный_артикул · XL / 50';
const labels=kind=>{const block=source.split('turnover-filter-grid--'+kind+'">')[1].split('</div>')[0];return [...block.matchAll(/<span>([^<]+)<\/span>|label="([^"]+)"/g)].map(m=>m[1]||m[2]);};
assert.deepEqual(labels('primary'),['Клиент','Поиск по товару','Штрихкод']);
assert.deepEqual(labels('secondary'),['КИЗ','Короб','Период с','Период по']);
const row=(kind)=>`<div class="turnover-filter-grid turnover-filter-grid--${kind}">${labels(kind).map((name,i)=>`<label class="known-value-field"><span>${name}</span><div class="known-value-control"><input value="${name==='Поиск по товару'?'лин':''}">${kind==='primary'&&i===1?`<div class="known-value-options"><button><strong>${article}</strong><small>Костюм спортивный без начеса · остаток 2 шт · размер XL / 50</small></button></div>`:''}</div></label>`).join('')}</div>`;
// TEST: real stylesheet and filter order, measured in a browser at desktop and narrow widths.
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});try{const page=await browser.newPage();for(const width of [1600,1024,768,390]){
 await page.setViewportSize({width,height:500});await page.setContent(`<meta charset="utf-8"><style>*{box-sizing:border-box}body{font:16px Arial;margin:12px;--line:#dae0e8;--surface:white;--ink:#172135;--muted:#64748b}${css}</style><section class="turnover-panel">${row('primary')}${row('secondary')}<div class="turnover-filter-actions"><button>Показать</button><button>Найти короб</button></div></section>`);
 const sizes=await page.locator('.turnover-filter-grid--primary > label').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,top:n.getBoundingClientRect().top})));
 if(width>900){assert.equal(sizes[0].top,sizes[1].top);assert.equal(sizes[1].top,sizes[2].top);assert(sizes[1].width>sizes[0].width&&sizes[1].width>sizes[2].width);}
 assert(await page.locator('.known-value-options strong').evaluate(n=>getComputedStyle(n).whiteSpace==='normal'&&n.scrollWidth<=n.clientWidth+1));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(width===1600&&process.env.TURNOVER_SCREENSHOT)await page.screenshot({path:process.env.TURNOVER_SCREENSHOT});
 }console.log('PASS: filter order, wide product search, full article/size, no overflow at 1600/1024/768/390');}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});


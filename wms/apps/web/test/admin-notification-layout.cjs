// TEST: render the actual notification component with the app CSS at desktop/mobile sizes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});try{const page=await browser.newPage();
for(const width of [1200,635,375]){await page.setViewportSize({width,height:900});await page.goto((process.env.TEST_BASE_URL||'http://127.0.0.1:5193')+'/test/admin-notification-layout.html');await page.locator('.admin-notification-row').first().waitFor();
const rows=await page.locator('.admin-notification-row').evaluateAll(rows=>rows.map(row=>{const body=row.querySelector('.header-notification-item__body');return {rowWidth:row.clientWidth,bodyWidth:body.clientWidth,overflow:body.scrollWidth>body.clientWidth,clipped:[...body.children].some(el=>el.scrollHeight>el.clientHeight||el.scrollWidth>el.clientWidth),wrap:getComputedStyle(body.querySelector('strong')).whiteSpace};}));
for(const row of rows){assert(row.bodyWidth>row.rowWidth*.7,JSON.stringify(row));assert(!row.overflow&&!row.clipped,JSON.stringify(row));assert.notEqual(row.wrap,'nowrap');}
assert((await page.locator('#ordinary').evaluate(el=>getComputedStyle(el).gridTemplateColumns)).startsWith('38px'));
if(process.env.TEST_SCREENSHOT&&width===635)await page.screenshot({path:process.env.TEST_SCREENSHOT,fullPage:true});}
console.log('NOTIFICATION_LAYOUT_PASSED');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

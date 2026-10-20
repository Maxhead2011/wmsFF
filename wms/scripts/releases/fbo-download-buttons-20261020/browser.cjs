const fs=require('fs'),assert=require('assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// TEST: the direct paragraph controls match the live FBO file/refresh footer.
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage();
  for(const width of [1280,390]){
   await page.setViewportSize({width,height:600});
   await page.setContent(`<style>body{font:16px Arial;color:#334155}*{box-sizing:border-box}${fs.readFileSync(process.argv[2],'utf8')}</style>
    <div aria-label="Двухэтапная сборка ФБО"><section>
    <p>Скачать отдельно: <button id="products">Файл товаров WB</button> <button id="packages">Файл коробов WB</button></p>
    <p><button>Обновить</button> <button>Закрыть</button></p>
    </section></div><button id="outside">Outside</button>`);
   const button=page.locator('#products');
   assert.equal(await button.evaluate(b=>getComputedStyle(b).borderRadius),'12px');
   assert((await button.boundingBox()).height>=44);
   assert.notEqual(await page.locator('#outside').evaluate(b=>getComputedStyle(b).borderRadius),'12px');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.evaluate(()=>{window.clicked=[];document.querySelectorAll('button').forEach(b=>b.onclick=()=>window.clicked.push(b.id))});
   await button.click();await page.locator('#packages').click();
   assert.deepEqual(await page.evaluate(()=>window.clicked),['products','packages']);
   await button.evaluate(b=>b.disabled=true);assert.equal(await button.evaluate(b=>getComputedStyle(b).cursor),'not-allowed');
   await page.screenshot({path:process.argv[3]+'/buttons-'+width+'.png'});
  }
  fs.writeFileSync(process.argv[3]+'/browser-proof.json',JSON.stringify({passed:2,widths:[1280,390],cssOnly:true}));
  console.log('PASS desktop/mobile styling, isolation, wrapping and click targets');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

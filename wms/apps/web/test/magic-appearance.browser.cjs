// TEST: real components, cleanup, navigation, supplied assets and responsive bounds.
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.MAGIC_TEST_URL||'http://127.0.0.1:5187')+'/test/magic-appearance.html');
 const select=page.getByLabel('Стиль оформления');await select.selectOption('winx');
 const background=()=>page.locator('.magic-wallpaper').evaluate(e=>e.style.backgroundImage);
 await page.waitForFunction(()=>document.querySelector('.magic-wallpaper')?.style.backgroundImage);
 let old=await background();await page.getByLabel('Поиск').fill('короб');assert.equal(await background(),old);
 await page.getByRole('button',{name:'Товары',exact:true}).click();assert.equal(await background(),old);
 for(let i=0;i<10;i++){
  await page.getByRole('button',{name:i%2?'Товары':'Сборка',exact:true}).click();
  await page.waitForFunction(old=>document.querySelector('.magic-wallpaper').style.backgroundImage!==old,old);old=await background();
 }
 assert.deepEqual(await page.locator('.magic-wallpaper').evaluate(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}),[0,0,1440,900]);
 assert.equal(await page.locator('.app-layout').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
 assert.equal(await page.locator('.panel').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
 await page.mouse.move(700,150);await page.waitForFunction(()=>document.documentElement.dataset.magicCursor==='true');
 await page.getByLabel('Поиск').hover();assert.equal(await page.evaluate(()=>document.documentElement.dataset.magicCursor),undefined);
 await page.route('**/themes/magic/winx/*.webp',route=>route.abort());
 const beforeFailure=await background();await page.getByRole('button',{name:'Остатки',exact:true}).click();await page.waitForTimeout(200);assert.equal(await background(),beforeFailure);await page.unroute('**/themes/magic/winx/*.webp');
 await select.selectOption('disney');await page.waitForFunction(()=>document.querySelector('.magic-wallpaper')?.style.backgroundImage.includes('/disney/'));
 await page.reload();await page.waitForFunction(()=>document.querySelector('.magic-wallpaper')?.style.backgroundImage.includes('/disney/'));
 await page.getByRole('button',{name:'Другой пользователь'}).click();assert.equal(await select.inputValue(),'dark');assert.equal(await page.locator('.magic-wallpaper').count(),0);
 await select.selectOption('winx');await page.getByRole('button',{name:'Сменить тему'}).click();assert.equal(await page.locator('.magic-wallpaper').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.dataset.uiMagic),undefined);
 await page.getByRole('button',{name:'Загрузка',exact:true}).click();await page.locator('.magic-welcome video').waitFor();
 const welcome=await page.locator('.magic-welcome').boundingBox(); assert.ok(welcome.width<=560);assert.ok(Math.abs(welcome.x+welcome.width/2-720)<1);assert.ok(Math.abs(welcome.y+welcome.height/2-450)<1);
 await page.getByRole('button',{name:'Пропустить'}).click();assert.equal(await page.locator('.magic-welcome').count(),0);
 await page.getByRole('button',{name:'Загрузка',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Загрузка',exact:true}).click();assert.equal(await page.locator('.magic-welcome video').count(),0);assert.equal(await page.locator('.magic-welcome img').count(),1);
 await page.getByRole('button',{name:'Загрузка',exact:true}).click();assert.equal(await page.locator('.magic-welcome').count(),0);
 const sources=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../public/themes/magic/sources.json'),'utf8'));
 const files=Object.values(sources).flat().map(x=>x.file);
 assert.equal(files.length,33);
 assert.deepEqual(await page.evaluate(async files=>Promise.all(files.map(src=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(i.naturalWidth>0);i.onerror=()=>resolve(false);i.src=src;}))),files),Array(33).fill(true));
 await page.getByRole('button',{name:'Сменить тему'}).click();await select.selectOption('disney');
 await page.setViewportSize({width:360,height:800});await page.waitForTimeout(300);
 assert.equal(await page.locator('.magic-wallpaper').evaluate(e=>e.getBoundingClientRect().width),360);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(process.env.MAGIC_SCREENSHOT_DIR){fs.mkdirSync(process.env.MAGIC_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.MAGIC_SCREENSHOT_DIR,'magic-mobile.png')});}
 await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'Загрузка',exact:true}).click();if(process.env.MAGIC_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.MAGIC_SCREENSHOT_DIR,'magic-desktop.png')});
 assert.deepEqual(errors,[]);console.log('PASS: 33 images, no-repeat navigation, full viewport, opacity, cursor, user isolation, cleanup, welcome skip/end, reduced motion, mobile');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

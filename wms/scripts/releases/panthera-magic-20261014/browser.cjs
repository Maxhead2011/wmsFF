// TEST: real components, cleanup, navigation, supplied assets and responsive bounds.
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 
 const root=process.argv[2],base=process.argv[3];
 const file=n=>fs.existsSync(path.join(root,n))?path.join(root,n):path.join(base,n);
 const html=fs.readFileSync(file('index.html'),'utf8'),entry=/src="\/assets\/([^"/]+\.js)"/.exec(html)[1];
 const links=(html.match(/<link[^>]*rel="stylesheet"[^>]*>/g)||[]).join('');
 await page.route('http://wms.logoff.pro/**',async route=>{
  const n=new URL(route.request().url()).pathname.slice(1);
  if(n==='fixture')return route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width, initial-scale=1">'+links+'</head><body><div id="root" style="display:none"></div><div id="fixture-root"></div></body></html>'});
  if(n.startsWith('api/'))return route.fulfill({contentType:'application/json',body:'[]'});
  const f=file(n);if(!fs.existsSync(f))return route.abort();let body=fs.readFileSync(f);
  if(n==='assets/'+entry)body=body.toString()+'\nexport {x as MagicReact,iT as MagicDom,__Magic as Magic};';
  await route.fulfill({contentType:n.endsWith('.js')?'application/javascript':n.endsWith('.css')?'text/css':n.endsWith('.webp')?'image/webp':n.endsWith('.png')?'image/png':n.endsWith('.mp4')?'video/mp4':'application/octet-stream',body});
 });
 await page.goto('http://wms.logoff.pro/fixture');
 await page.evaluate(async entry=>{
  const {MagicReact:R,MagicDom:D,Magic:M}=await import('/assets/'+entry);const h=R.createElement;
  function Fixture(){const [menu,setMenu]=R.useState('Товары'),[user,setUser]=R.useState('one'),[mounted,setMounted]=R.useState(true),[loading,setLoading]=R.useState(false);
   return h('div',{className:'app-layout'},h('aside',{className:'app-sidebar'},h('h2',{},'LOGOFF'),...['Товары','Сборка','Остатки'].map(m=>h('button',{key:m,onClick:()=>setMenu(m)},m))),h('main',{className:'workspace-shell'},h('header',{className:'workspace-header'},mounted&&h(M.ThemeStyleSwitcher,{key:user,userId:user,workspaceId:menu})),h('section',{className:'workspace-content'},h('section',{className:'panel'},h('h2',{},menu),h('input',{'aria-label':'Поиск'}),h('button',{onClick:()=>setUser(user==='one'?'two':'one')},'Другой пользователь'),h('button',{onClick:()=>setMounted(!mounted)},'Сменить тему'),h('button',{onClick:()=>setLoading(!loading)},'Загрузка')),loading&&h(M.MagicWelcome,{user:{id:'f89c0efe-dcd2-4dfa-9cea-e35c0c492f83',name:'Соня'}}))));
  }D.createRoot(document.getElementById('fixture-root')).render(h(Fixture));
 },entry);
 await page.waitForTimeout(200);await page.evaluate(()=>{document.documentElement.dataset.uiTheme='modern';document.documentElement.dataset.uiVariant='la_panthera';});

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
 await page.evaluate(()=>{window.OriginalImage=window.Image;window.Image=class extends window.OriginalImage{set src(value){queueMicrotask(()=>this.onerror?.(new Event('error')));}};});
 const beforeFailure=await background();await page.getByRole('button',{name:'Остатки',exact:true}).click();await page.waitForTimeout(200);assert.equal(await background(),beforeFailure);await page.evaluate(()=>{window.Image=window.OriginalImage;delete window.OriginalImage;});
 await select.selectOption('disney');await page.waitForFunction(()=>document.querySelector('.magic-wallpaper')?.style.backgroundImage.includes('/disney/'));
 await page.getByRole('button',{name:'Сменить тему'}).click();await page.getByRole('button',{name:'Сменить тему'}).click();await page.waitForFunction(()=>document.querySelector('.magic-wallpaper')?.style.backgroundImage.includes('/disney/'));
 await page.getByRole('button',{name:'Другой пользователь'}).click();assert.equal(await select.inputValue(),'dark');assert.equal(await page.locator('.magic-wallpaper').count(),0);
 await select.selectOption('winx');await page.getByRole('button',{name:'Сменить тему'}).click();assert.equal(await page.locator('.magic-wallpaper').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.dataset.uiMagic),undefined);
 await page.getByRole('button',{name:'Загрузка',exact:true}).click();await page.locator('.magic-welcome video').waitFor();
 const welcome=await page.locator('.magic-welcome').boundingBox(); assert.ok(welcome.width<=560);assert.ok(Math.abs(welcome.x+welcome.width/2-720)<1);assert.ok(Math.abs(welcome.y+welcome.height/2-450)<1);
 await page.getByRole('button',{name:'Пропустить'}).click();assert.equal(await page.locator('.magic-welcome').count(),0);
 await page.getByRole('button',{name:'Загрузка',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Загрузка',exact:true}).click();assert.equal(await page.locator('.magic-welcome video').count(),0);assert.equal(await page.locator('.magic-welcome img').count(),1);
 await page.getByRole('button',{name:'Загрузка',exact:true}).click();assert.equal(await page.locator('.magic-welcome').count(),0);
 const sources=JSON.parse(fs.readFileSync(file('themes/magic/sources.json'),'utf8'));
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

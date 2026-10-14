// TEST: actual production account IDs and fresh login, independent of appearance.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{const root=process.argv[2],base=process.argv[3],file=n=>fs.existsSync(path.join(root,n))?path.join(root,n):path.join(base,n);
const html=fs.readFileSync(file('index.html'),'utf8'),entry=/src="\/assets\/([^"/]+\.js)"/.exec(html)[1],script=fs.readFileSync(file('assets/'+entry),'utf8');
const key=/\bvp="([^"]+)"/.exec(script)?.[1];assert(key);
const browser=await chromium.launch({channel:'msedge',headless:true});try{
 for(const [id,name,style]of [['8e175b30-8535-4881-9324-a875c9fd8c1d','Элькапоне','winx'],['f89c0efe-dcd2-4dfa-9cea-e35c0c492f83','Соня','disney']]){
 for(const theme of ['la_panthera','spirit','soul']){
 const fresh=true;
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 const user={id,name,email:'fixture',roleCodes:['WORKER'],permissionCodes:[],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],warehouseIds:[]};
 await page.addInitScript(({key,user,style,fresh,theme})=>{if(!fresh)localStorage.setItem(key,JSON.stringify({accessToken:'fixture',tokenType:'Bearer',user}));localStorage.setItem('logoff-wms-ui-theme:'+user.id,theme);localStorage.setItem('logoff-wms-ui-style:la_panthera:'+user.id,style);},{key,user,style,fresh,theme});
 let releaseMe;const ready=new Promise(resolve=>releaseMe=resolve);
 await page.route('https://wms.logoff.pro/**',async route=>{const n=new URL(route.request().url()).pathname.slice(1);
 if(n.startsWith('api/')){if(route.request().method()!=='GET')writes.push(n);let body=[];if(n.endsWith('/auth/login'))body={accessToken:'fixture',tokenType:'Bearer',user};if(n.endsWith('/auth/me')){await ready;body=user;}return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});}
 if(process.env.MAGIC_PUBLIC_ASSETS==='1')return route.continue();
 const f=file(n||'index.html');if(!fs.existsSync(f))return route.abort();return route.fulfill({path:f,contentType:n.endsWith('.js')?'application/javascript':n.endsWith('.css')?'text/css':n.endsWith('.mp4')?'video/mp4':n.endsWith('.webp')?'image/webp':n.endsWith('.png')?'image/png':n===''?'text/html':undefined});});
 await page.goto('https://wms.logoff.pro/'+(fresh?'#login':''));if(fresh){releaseMe();await page.locator('input[autocomplete="username"]').fill('fixture');await page.locator('input[type="password"]').fill('fixture');await page.locator('form button[type="submit"]').click();await page.locator('.magic-welcome').waitFor({timeout:5000});assert.ok((await page.locator('.magic-welcome video').getAttribute('src')).includes(style));await page.waitForFunction(()=>{const v=document.querySelector('.magic-welcome video');return v&&v.currentTime>0.1&&!v.paused;});assert.equal(await page.locator('.magic-welcome h1').innerText(),'Добро пожаловать в мир волшебства и порядка');assert.equal(await page.locator('.magic-welcome video').evaluate(v=>v.loop),false);if(theme==='soul')await page.locator('.magic-welcome video').dispatchEvent('ended');else if(theme==='spirit')await page.locator('.magic-welcome video').dispatchEvent('error');else await page.getByRole('button',{name:'Пропустить',exact:true}).click();}else{await page.locator('.magic-welcome').waitFor();
 assert.ok((await page.locator('.magic-welcome').boundingBox()).width<=560);
 assert.ok((await page.locator('.magic-welcome video').getAttribute('src')).includes(style));releaseMe();}
 await page.waitForFunction(()=>!document.querySelector('.magic-welcome')&&!document.querySelector('.auth-form'));
 assert.equal(await page.locator('.personal-login-welcome').count(),0);
 assert.deepEqual(errors,[]);assert.deepEqual(writes,fresh?['api/v1/auth/login']:[]);await page.close();}
 }
 console.log('PASS: 6 personal logins, all themes, exact text, actual video playback, skip/ended/error; only mocked login POST, no business writes/errors');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

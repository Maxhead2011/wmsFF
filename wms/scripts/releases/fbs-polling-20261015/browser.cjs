const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const root=process.argv[2],mode=process.argv[3]||'web',base=path.join(root,'web-base'),candidate=path.join(root,mode),file=n=>fs.existsSync(path.join(candidate,n))?path.join(candidate,n):path.join(base,n);
 const html=fs.readFileSync(file('index.html'),'utf8'),entry=/src="\/assets\/([^"/]+\.js)"/.exec(html)[1];
 const chunk=fs.readdirSync(path.join(candidate,'assets')).find(n=>n.endsWith('.js')&&fs.readFileSync(path.join(candidate,'assets',n),'utf8').includes('fbs-marketplace-entry'));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage(),calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://localhost/**',async route=>{
   const n=new URL(route.request().url()).pathname.slice(1);
   if(n.startsWith('api/')){calls.push(n);let data=[];if(n.includes('/orders'))data={orders:[],supplies:[],sync:{refreshing:false}};return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});}
   if(n==='fixture')return route.fulfill({contentType:'text/html',body:'<div id="root" hidden></div><div id="window"><div id="fixture-root"></div></div>'});
   if(!fs.existsSync(file(n)))return route.abort();let body=fs.readFileSync(file(n),'utf8');
   if(n==='assets/'+entry)body+='\nexport {x as TestReact,ws as TestDom};';
   if(n==='assets/'+chunk){body=body.replace(/document\.visibilityState==="visible"&&([\w$]+)\(\)/g,(_,x)=>`document.visibilityState==="visible"&&(globalThis.pollHits.push('${x}'),${x}())`).replace(/__fbsPoll\(\(\)=>\s*([\w$]+)\(\)/g,(_,x)=>`__fbsPoll(()=>(globalThis.pollHits.push('${x}'),${x}())`);body+='\nglobalThis.TestFbs=ci;';}
   return route.fulfill({contentType:n.endsWith('.js')?'application/javascript':n.endsWith('.css')?'text/css':'text/plain',body});
  });
  await page.goto('http://localhost/fixture');await page.clock.install();
  await page.evaluate(async({entry,chunk})=>{const main=await import('/assets/'+entry);await import('/assets/'+chunk);window.pollHits=[];window.fbsRoot=main.TestDom.createRoot(document.getElementById('fixture-root'));fbsRoot.render(main.TestReact.createElement(TestFbs,{session:{accessToken:'fixture',user:{id:'u',permissionCodes:['system:admin'],roleCodes:['ADMIN'],clientIds:[]}}}));},{entry,chunk});
  await page.locator('.fbs-marketplace-entry').waitFor({timeout:10000}).catch(async e=>{console.log(errors,await page.locator('body').innerText());throw e;});await page.waitForTimeout(200);
  console.log('visible');await page.clock.fastForward(60_001);await page.waitForTimeout(200);const before=await page.evaluate(()=>pollHits.length);assert(before>0);
  await page.evaluate(()=>document.getElementById('window').hidden=true);await page.clock.fastForward(180_001);await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>pollHits.length),before,'Hidden FBS window still polls');
  await page.evaluate(()=>document.getElementById('window').hidden=false);await page.waitForTimeout(300);assert(await page.evaluate(()=>pollHits.length)>before,'Restore must refresh');
  await page.evaluate(()=>document.getElementById('window').classList.add('panthera-window-minimized'));const minimized=await page.evaluate(()=>pollHits.length);await page.clock.fastForward(120_001);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>pollHits.length),minimized);
  await page.evaluate(()=>document.getElementById('window').classList.remove('panthera-window-minimized'));await page.waitForTimeout(300);assert(await page.evaluate(()=>pollHits.length)>minimized);
  await page.evaluate(()=>fbsRoot.unmount());const unmounted=await page.evaluate(()=>pollHits.length);await page.clock.fastForward(120_001);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>pollHits.length),unmounted);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:5,actualGraph:true,mode}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

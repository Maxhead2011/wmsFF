// TEST: manager confirmation and scoped capability in the actual candidate graph.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=process.argv[2],entry=/src="\/assets\/([^"/]+\.js)"/.exec(fs.readFileSync(path.join(root,'index.html'),'utf8'))[1];
const row={id:'review',status:'OPEN',active:true,decision:'RELABEL',physicalReuseAllowed:true,kizIdentity:'test-serial',createdAt:new Date().toISOString(),attempts:1,snapshot:{requestNumber:2014,orderId:'6028038996',productName:'Товар',boxCode:'FFL_TEST'}};
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage(),errors=[];let decisions=0;page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://fixture.test/**',async route=>{const n=new URL(route.request().url()).pathname.slice(1);
  if(n==='fixture')return route.fulfill({contentType:'text/html',body:'<div id="root" hidden></div><div id="test-root"></div>'});
  if(n.startsWith('api/')){let data={items:[row],nextCursor:null};if(n.endsWith('/decision')){assert.deepEqual(route.request().postDataJSON(),{resolution:'REUSE',reason:'Единица физически проверена',confirmed:true});decisions++;data={id:'review',status:'APPROVED',resolution:'REUSE'};}return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});}
  const p=path.join(root,n);if(!fs.existsSync(p))return route.abort();let body=fs.readFileSync(p,'utf8');if(n==='assets/'+entry)body+='\nexport {x as TestReact,ws as TestDom,f4 as TestPanel,p4 as TestCard};';return route.fulfill({contentType:'application/javascript',body});
 });
 await page.goto('http://fixture.test/fixture');await page.evaluate(async entry=>{const m=await import('/assets/'+entry);window.m=m;window.rt=m.TestDom.createRoot(document.getElementById('test-root'));m.TestDom.flushSync(()=>rt.render(m.TestReact.createElement(m.TestPanel,{session:{accessToken:'fixture'},onInspect:()=>{}})));},entry);
 await page.locator('details summary').click();await page.getByRole('button',{name:'Разрешить использовать',exact:true}).click();
 const confirm=page.getByRole('button',{name:'Подтвердить решение',exact:true});assert(await confirm.isDisabled());assert.equal(decisions,0);
 await page.getByRole('textbox').fill('Единица физически проверена');assert(await confirm.isDisabled());await page.getByRole('checkbox').check();await confirm.click();await page.getByRole('status').waitFor();assert.equal(decisions,1);
 await page.evaluate(row=>m.TestDom.flushSync(()=>rt.render(m.TestReact.createElement(m.TestCard,{row:{...row,physicalReuseAllowed:false},disabled:false,onDecision:()=>{},onInspect:()=>{}}))),row);
 await page.locator('details summary').click();assert(await page.getByRole('button',{name:'Разрешить использовать',exact:true}).isDisabled());assert.deepEqual(errors,[]);
 console.log('PASS actual graph: explicit reason + confirmation, server capability, no implicit approval');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

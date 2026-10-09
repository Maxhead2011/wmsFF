// TEST: execute the actual candidate graph, not a separate component build.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=process.argv[2],entry=/src="\/assets\/([^"/]+\.js)"/.exec(fs.readFileSync(path.join(root,'index.html'),'utf8'))[1];
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage(),errors=[];let detailReads=0,planReads=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://fixture.test/**',async route=>{
  const url=new URL(route.request().url()),n=url.pathname.slice(1);
  if(n==='fixture')return route.fulfill({contentType:'text/html',body:'<div id="root" style="display:none"></div><div id="fixture-root"></div>'});
  if(n.startsWith('api/')){
   let data=[];
   if(n.includes('receipt-channels')){
    const details=url.searchParams.has('receiptId');if(details)detailReads++;
    data={enabled:true,rows:[{id:'a'.repeat(32),warehouseId:'w',sourceDocument:'SERIES:2026:BOX',date:'2026-10-09',received:8,current:true,boxes:details?[{code:'BOX_1'},{code:'BOX_2'}]:[],...(details?{}:{boxCount:2}),fbs:true,fbo:true,revision:0}]};
   }
   if(n.includes('/tsd/requests/')){planReads++;await new Promise(r=>setTimeout(r,100));data={id:'r'};}
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  const file=path.join(root,n);if(!fs.existsSync(file))return route.abort();
  let body=fs.readFileSync(file,'utf8');if(n==='assets/'+entry)body+='\nexport {x as TestReact,ws as TestDom,__ReceiptDirections as TestDirections,M9 as TestPlan};';
  return route.fulfill({contentType:n.endsWith('.js')?'application/javascript':'text/html',body});
 });
 await page.goto('http://fixture.test/fixture');
 await page.evaluate(async entry=>{const m=await import('/assets/'+entry);window.fixture=m;m.TestDom.createRoot(document.getElementById('fixture-root')).render(m.TestReact.createElement(m.TestDirections.ReceiptDirectionsPanel,{session:{accessToken:'fixture',user:{roleCodes:['OWNER']}},fixedClientId:'c'}));},entry);
 await page.getByText('2 коробов',{exact:true}).waitFor();assert.equal(detailReads,0);
 await page.getByText('2 коробов',{exact:true}).click();await page.getByText('BOX_2',{exact:true}).waitFor();assert.equal(detailReads,1);
 await page.getByText('2 коробов',{exact:true}).click();await page.getByText('2 коробов',{exact:true}).click();assert.equal(detailReads,1);
 await page.evaluate(()=>Promise.all([window.fixture.TestPlan('fixture','r'),window.fixture.TestPlan('fixture','r')]));assert.equal(planReads,1);
 await page.evaluate(()=>window.fixture.TestPlan('fixture','r'));assert.equal(planReads,2);
 assert.deepEqual(errors,[]);console.log('PASS actual graph: lazy receipt boxes; pending-only shared plan reads; fresh subsequent response');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

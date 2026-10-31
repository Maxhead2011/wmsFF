// TEST: actual overlay component, delivery validation, billing, error and client access.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(process.argv[2]);
const fallback='D:/WMSFF/_Kof/work/client-kiz-release-20261031/web-base';
const server=http.createServer((req,res)=>{const rel=new URL(req.url,'http://local').pathname.slice(1)||'index.html';if(rel.includes('..'))return res.end();let p;for(const dir of ['web-payload','web-base',fallback]){const n=path.isAbsolute(dir)?path.join(dir,rel):path.join(root,dir,rel);if(fs.existsSync(n)){p=n;break;}}if(!p){res.writeHead(404);return res.end()}let s=fs.readFileSync(p);if(rel==='assets/cargo-pickup-20261031.js')s=Buffer.from(s.toString()+'\nwindow.__Test={React:x,DOM:j5,Panel:__CargoArrival.GoodsArrivalPanel};');res.writeHead(200,{'Content-Type':rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':'application/octet-stream'});res.end(s)});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],writes=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)});let fail=false;
 await page.route('**/api/v1/**',async route=>{const req=route.request(),url=req.url();
  if(url.includes('/goods-arrivals/summary'))return route.fulfill({json:{cargoPickupEnabled:true,estimatedRub:0}});
  if(url.includes('/goods-arrivals/bill-cargo')){writes.push(req.postDataJSON());return route.fulfill(fail?{status:409,json:{message:'Нет невыставленных заборов'}}:{json:{id:'invoice',number:'CARGO-1'}});}
  if(url.includes('/goods-arrivals')&&req.method()==='POST'){writes.push(req.postDataJSON());return route.fulfill({json:{id:'arrival'}});}
  if(url.includes('/goods-arrivals'))return route.fulfill({json:[]});
  if(/\/clients(\?|$)/.test(url))return route.fulfill({json:[{id:'c',name:'Тестовый клиент'}]});return route.fulfill({json:[]});});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__Test);
 await page.evaluate(()=>{document.getElementById('root').style.display='none';const n=document.createElement('section');n.id='test';document.body.append(n);window.testRoot=window.__Test.DOM.createRoot(n)});
 async function mount(client=false){await page.evaluate(client=>{const a=window.__Test;window.testRoot.render(a.React.createElement(a.Panel,{key:String(client),session:{accessToken:'synthetic',user:{id:'actor',roleCodes:client?['CLIENT']:[],permissionCodes:[]}}}))},client);}
 let passed=0;await mount();const panel=page.locator('#test');await panel.locator('select').first().selectOption('c');await panel.getByLabel('Наша доставка',{exact:true}).waitFor();assert.equal(await panel.getByLabel('Стоимость забора с карго, ₽').count(),0);passed++;
 await panel.getByLabel('Наша доставка',{exact:true}).check();const cost=panel.getByLabel('Стоимость забора с карго, ₽');await cost.waitFor();assert(await cost.evaluate(n=>n.required));passed++;
 await cost.fill('1250.50');await panel.getByLabel('Мешки',{exact:true}).fill('1');await panel.getByRole('button',{name:'Записать приход'}).click();await page.waitForFunction(()=>!document.querySelector('#test input[step="0.01"]'));assert(writes.some(w=>w.ourDelivery===true&&w.deliveryCostRub===1250.5));passed++;
 await panel.getByRole('button',{name:'Счёт «Забор товара с карго»',exact:true}).click();await panel.getByText(/CARGO-1 создан/).waitFor();assert(writes.some(w=>w.clientId==='c'&&w.periodFrom&&w.periodTo));passed++;
 fail=true;await panel.getByRole('button',{name:'Счёт «Забор товара с карго»',exact:true}).click();await panel.getByText('Нет невыставленных заборов').waitFor();passed++;
 await mount(true);await panel.locator('select').first().waitFor();assert.equal(await panel.getByRole('button',{name:'Записать приход'}).count(),0);assert.equal(await panel.getByRole('button',{name:'Счёт «Забор товара с карго»',exact:true}).count(),0);passed++;
 assert.deepEqual(errors,[]);fs.writeFileSync(root+'/browser-proof.json',JSON.stringify({passed,actualArtifact:true,errors}));console.log(JSON.stringify({passed}));
}finally{await browser.close();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);server.close();process.exitCode=1});

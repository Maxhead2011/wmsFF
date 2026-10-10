// TEST: render the actual patched browser graph with the actual candidate API response.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const ts=require('../../node_modules/typescript');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const [root,base,api]=process.argv.slice(2);
const entry=/src="\/assets\/([^"/]+\.js)"/.exec(fs.readFileSync(path.join(root,'index.html'),'utf8'))[1];
const chunk=fs.readdirSync(path.join(root,'assets')).find(n=>fs.readFileSync(path.join(root,'assets',n),'utf8').includes('reserved.toLocaleString'));
const ast=ts.createSourceFile('stock.js',fs.readFileSync(path.join(root,'assets',chunk),'utf8'),99,true);
const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.getText(ast).includes('reserved.toLocaleString')).name.text;
(async()=>{
 process.env.WMS_MARKETPLACE_PRODUCT_LINKS_ENABLED='false';process.env.WMS_WB_STOCK_FINE_SETTINGS='true';
 const {MarketplaceConnectionsService:Service}=require(path.join(api,'modules/marketplace-connections/marketplace-connections.service.js'));
 const quantities=[10,26,89],skus=quantities.map((v,i)=>({id:'s'+i,name:'Костюм '+i,internalSku:'s'+i,marketplaceProductId:`1:${100+i}`,barcodes:[]}));
 const service=new Service({sku:{findMany:async()=>skus},fbsStockPublication:{findMany:async()=>skus.map(s=>({skuId:s.id,enabled:true,saleLimit:null}))}},{});
 service.calculateFbsRelabelStockPlan=async()=>({quantities:new Map(quantities.map((v,i)=>['s'+i,{available:v,reserved:0,sellable:v}])),meta:new Map(),reserve:{mode:'UNITS',value:3},skuRules:new Map()});
 service.fetchWildberriesStockAmounts=async()=>new Map([[100,7],[101,23],[102,86]]);
 const data=await service.buildFbsStocksResponse({id:'client',name:'ИП Кубрин Е. В.'},[{id:'connection'}],{id:'connection'},[{id:'warehouse',name:'Logoff. Вешки'}],{id:'warehouse'},'warehouse','Logoff. Вешки','execution');
 assert.equal(data.summary.sellable,116);
 const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1800,height:1100}}),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://localhost/**',async route=>{
  const n=new URL(route.request().url()).pathname.slice(1);
  if(n==='fixture')return route.fulfill({contentType:'text/html',body:'<div id="root" style="display:none"></div><div id="fixture-root"></div>'});
  if(n.startsWith('api/')){if(route.request().method()!=='GET')writes.push(n);return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});}
  const file=[path.join(root,n),path.join(base,n)].find(p=>fs.existsSync(p));if(!file)return route.abort();let body=fs.readFileSync(file);
  if(n==='assets/'+entry)body=body.toString()+'\nexport {x as TestReact,ws as TestDom};';
  if(n==='assets/'+chunk)body=body.toString()+`\nexport {${component} as TestStocks};`;
  return route.fulfill({contentType:n.endsWith('.js')?'application/javascript':n.endsWith('.css')?'text/css':'text/html',body});
 });
 await page.goto('http://localhost/fixture');
 await page.evaluate(async({entry,chunk})=>{
  const m=await import('/assets/'+entry),s=await import('/assets/'+chunk);
  m.TestDom.createRoot(document.getElementById('fixture-root')).render(m.TestReact.createElement(s.TestStocks,{clientId:'client',search:'',session:{accessToken:'fixture',user:{permissionCodes:[],roleCodes:[]}}}));
 },{entry,chunk});
 await page.getByRole('columnheader',{name:'Страховой резерв',exact:true}).waitFor();
 assert.equal(await page.getByRole('columnheader',{name:'Резерв заказов',exact:true}).count(),1);
 await page.getByText('116 шт.',{exact:true}).waitFor();
 const rows=page.locator('tbody tr');assert.equal(await rows.count(),3);
 for(let i=0;i<3;i++){
  const cells=await rows.nth(i).locator('td').allTextContents();
  assert.deepEqual(cells.slice(3,7),[String(quantities[i]),'0','3',String(quantities[i]-3)]);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log('PASS: actual API/browser graph; order/safety reserves separated; 7+23+86=116; no mutations');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

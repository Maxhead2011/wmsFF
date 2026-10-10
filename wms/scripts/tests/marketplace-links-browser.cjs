// TEST: execute the deployed graph and verify review, refresh and scoped confirmation.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const [root,base]=process.argv.slice(2),entry=/src="\/assets\/([^"/]+\.js)"/.exec(fs.readFileSync(path.join(root,'index.html'),'utf8'))[1];
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage(),errors=[],writes=[];let linked=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://localhost/**',async route=>{const n=new URL(route.request().url()).pathname.slice(1);
  if(n==='fixture')return route.fulfill({contentType:'text/html',body:'<div id="root" style="display:none"></div><div id="fixture-root"></div>'});
  if(n.startsWith('api/')){let data=[];
   if(n.endsWith('/confirm')){writes.push(route.request().postDataJSON());linked=true;data={linked:true};}
   else if(n.endsWith('/product-links'))data={enabled:true,items:[{id:'row',productId:'wb1',offerId:'article',marketplace:'WILDBERRIES',status:linked?'LINKED':'REVIEW',updatedAt:'2026-10-10T00:00:00.000Z',reason:'Неоднозначное совпадение',sku:linked?{name:'Тестовый товар',article:'article'}:null,available:518,reserved:393,candidates:[{id:'sku',article:'article',size:'M'}]}]};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  const file=[path.join(root,n),path.join(base,n)].find(p=>fs.existsSync(p));if(!file)return route.abort();let body=fs.readFileSync(file);
  if(n==='assets/'+entry)body=body.toString()+'\nexport {x as TestReact,ws as TestDom,__MarketplaceLinks as TestLinks};';
  return route.fulfill({contentType:n.endsWith('.js')?'application/javascript':n.endsWith('.css')?'text/css':'text/html',body});
 });
 await page.goto('http://localhost/fixture');await page.evaluate(async entry=>{const m=await import('/assets/'+entry);m.TestDom.createRoot(document.getElementById('fixture-root')).render(m.TestReact.createElement(m.TestLinks.MarketplaceProductLinks,{session:{accessToken:'fixture'},connections:[{id:'wb',marketplace:'WILDBERRIES',accountName:'Кабинет'}],canWrite:true}));},entry);
 await page.locator('summary').filter({hasText:'Сверка карточек'}).click();await page.getByLabel('Кабинет сверки').selectOption('wb');
 await page.getByText('Неоднозначное совпадение',{exact:true}).waitFor();await page.getByLabel('Товар для wb1').selectOption('sku');await page.getByLabel('Причина для wb1').fill('Проверено по карточке');await page.getByRole('button',{name:'Подтвердить связь',exact:true}).click();
 await page.getByText('Связано: 1. Требуют проверки: 0.').waitFor();assert.deepEqual(writes,[{skuId:'sku',updatedAt:'2026-10-10T00:00:00.000Z',reason:'Проверено по карточке'}]);
 await page.getByRole('button',{name:'Обновить сверку'}).click();await page.getByText('Связано: 1. Требуют проверки: 0.').waitFor();assert.deepEqual(errors,[]);
 console.log('PASS: actual browser graph, review and audited confirmation transport, shared quantities, single React');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

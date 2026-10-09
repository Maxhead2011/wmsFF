// TEST: upload the customer's workbook through the real FBO Ozon entry, never the legacy parser.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=process.argv[2],base=process.argv[3],entry=/src="\/assets\/([^"/]+\.js)"/.exec(fs.readFileSync(path.join(root,'index.html'),'utf8'))[1];
const panel=fs.readdirSync(path.join(root,'assets')).find(n=>fs.readFileSync(path.join(root,'assets',n),'utf8').includes('function OzonEntry('));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage(),errors=[];let previews=0,commits=0,created=false,legacyImports=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://localhost/**',async route=>{
  const url=new URL(route.request().url()),n=url.pathname.slice(1);
  if(n==='fixture')return route.fulfill({contentType:'text/html',body:'<div id="root" style="display:none"></div><div id="fixture-root"></div>'});
  if(n.startsWith('api/')){let data=[];
   if(n==='api/v1/clients')data=[{id:'client',name:'Кубрин',code:'CL-14',status:'ACTIVE'}];
   if(n.endsWith('/capability'))data={enabled:true};
   if(n==='api/v1/ozon-fbo-import/requests')data=created?[{id:'r',number:1234,title:'Кросс-докинг',quantity:393,directions:11,phase:'NOT_STARTED'}]:[];
   if(n==='api/v1/ozon-fbo-import/preview'){previews++;assert.ok(route.request().postDataBuffer().includes(Buffer.from('filename=')));data={totalQuantity:393,directions:Array.from({length:11},(_,i)=>({name:'Направление '+i,items:[{quantity:1}]}))};}
   if(n==='api/v1/ozon-fbo-import/commit'){commits++;created=true;data={request:{id:'r',number:1234},existing:false};}
   if(n.startsWith('api/v1/ozon-fbo/')&&route.request().method()==='POST')legacyImports++;
   if(n==='api/v1/ozon-fbo/overview')data={connections:[],plans:[]};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  const file=[path.join(root,n),path.join(base,n)].find(f=>fs.existsSync(f));if(!file)return route.abort();let body=fs.readFileSync(file);
  if(n==='assets/'+entry)body=body.toString()+'\nexport {x as TestReact,ws as TestDom};';
  return route.fulfill({contentType:n.endsWith('.js')?'application/javascript':n.endsWith('.css')?'text/css':'text/html',body});
 });
 await page.goto('http://localhost/fixture');
 await page.evaluate(async({entry,panel})=>{const m=await import('/assets/'+entry),p=await import('/assets/'+panel);m.TestDom.createRoot(document.getElementById('fixture-root')).render(m.TestReact.createElement(p.OzonFboPanel,{session:{accessToken:'fixture',user:{id:'u',clientIds:['client'],roleCodes:['OWNER'],permissionCodes:['system:admin']}}}));},{entry,panel});
 await page.getByText('Одна сборка — несколько направлений',{exact:true}).waitFor();
 await page.getByLabel('Место общей отгрузки').fill('Москва');
 await page.getByLabel('Файл клиента',{exact:true}).setInputFiles('C:/Users/La_pa/Downloads/Telegram Desktop/Поставка Яна, Полузамок.xlsx');
 await page.getByRole('button',{name:'Проверить файл',exact:true}).click();
 await page.getByText('Одна сборка · 11 направлений · 393 шт.',{exact:true}).waitFor();
 assert.equal(previews,1);assert.equal(legacyImports,0);
 await page.getByRole('button',{name:'Создать единую сборку',exact:true}).click();
 await page.getByText('393 шт. · 11 направлений',{exact:true}).waitFor();assert.equal(commits,1);
 assert.equal(await page.getByText('Файл требует исправлений.',{exact:true}).count(),0);
 await page.getByRole('button',{name:'План через API Ozon',exact:true}).click();
 await page.getByText('Разобрать распределение',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS actual Ozon menu: client file preview, unified create/list, legacy preserved');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

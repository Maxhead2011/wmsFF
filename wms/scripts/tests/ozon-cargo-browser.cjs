// TEST: upload the customer's workbook through the real FBO Ozon entry, never the legacy parser.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=process.argv[2],base=process.argv[3],entry=/src="\/assets\/([^"/]+\.js)"/.exec(fs.readFileSync(path.join(root,'index.html'),'utf8'))[1];
const panel=fs.readdirSync(path.join(root,'assets')).find(n=>fs.readFileSync(path.join(root,'assets',n),'utf8').includes('function OzonEntry('));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage(),errors=[];let downloads=0;let previews=0,commits=0,created=false,legacyImports=0,uploads=0;
 const supply={requestId:'r',connections:[{id:'c',accountName:'Кабинет'}],directions:[{name:'Москва',items:[{quantity:1}]}],differences:[],packingError:'',link:null};

 page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://localhost/**',async route=>{
  const url=new URL(route.request().url()),n=url.pathname.slice(1);
  if(n==='fixture')return route.fulfill({contentType:'text/html',body:'<div id="root" style="display:none"></div><div id="fixture-root"></div>'});
  if(n.endsWith('/cargo-mapping.xlsx')){downloads++;assert.equal(route.request().headers()['authorization'],'Bearer fixture');return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:'fixture-xlsx'});}if(n.startsWith('api/')){let data=[];
   if(n==='api/v1/clients')data=[{id:'client',name:'Кубрин',code:'CL-14',status:'ACTIVE'}];
   if(n.endsWith('/capability'))data={enabled:true};
   if(n==='api/v1/ozon-fbo-import/requests')data=created?[{id:'r',number:1234,title:'Кросс-докинг',quantity:393,directions:11,phase:'NOT_STARTED'}]:[];
   if(n==='api/v1/ozon-fbo-import/preview'){previews++;assert.ok(route.request().postDataBuffer().includes(Buffer.from('filename=')));data={totalQuantity:393,directions:Array.from({length:11},(_,i)=>({name:'Направление '+i,items:[{quantity:1}]}))};}
   if(n==='api/v1/ozon-fbo-import/commit'){commits++;created=true;data={request:{id:'r',number:1234},existing:false};}
   if(n.startsWith('api/v1/ozon-fbo-import/requests/r/supply')){
    const action=n.split('/supply')[1];
    if(action==='/bind'){const previous=supply.link; supply.link={connectionId:'c',orderId:'123',orderNumber:'123',place:'Москва',date:'',state:'DATA_FILLING',mapping:{},supplies:[{id:'s',name:'Москва',items:[{quantity:1}]}],operations:{}};const orderId=JSON.parse(route.request().postData()).orderId;supply.link.orderId=orderId;supply.link.orderNumber=orderId;supply.link.orders=[...(previous?.orders??[]),{...supply.link}];supply.differences=['Выберите направление'];}
    if(action==='/mapping'){supply.link.mapping={Москва:'s'};supply.differences=[];}
    if(action==='/upload'){uploads++;supply.link.frozenHash='frozen';supply.link.operations={s:{state:'SUCCESS'}};}
    if(action==='/labels')supply.link.operations.s.labelUrl='https://example.com/fixture.pdf';
    data=supply;
   }
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

 await page.getByRole('button',{name:'Поставка и грузоместа Ozon',exact:true}).click();
 await page.getByLabel('Ссылка или ID заявки Ozon из адреса кабинета').fill('123');
 await page.getByRole('button',{name:'Добавить заявку Ozon',exact:true}).click();
 for(const id of ['124','125','126']){
 await page.getByLabel('Ссылка или ID заявки Ozon из адреса кабинета').fill(id);
 await page.getByRole('button',{name:'Добавить заявку Ozon',exact:true}).click();
 await page.getByRole('link',{name:'Ozon №'+id,exact:true}).waitFor();
}
await page.getByText('Заявки Ozon общей сборки (4)',{exact:true}).waitFor();
assert.equal(await page.getByRole('link',{name:/Ozon №/}).count(),4);
await page.getByText('Есть расхождения — отправка заблокирована').waitFor();
 assert.ok(await page.getByRole('button',{name:'Передать короба в Ozon',exact:true}).isDisabled());
 await page.getByRole('group',{name:'Направления из файла → Ozon'}).getByRole('combobox').selectOption('s');
 await page.getByRole('button',{name:'Сохранить соответствия'}).click();
 await page.getByText('Состав файла совпадает с Ozon.').waitFor();
 assert.ok(await page.getByRole('button',{name:'Передать короба в Ozon',exact:true}).isDisabled());
 await page.getByLabel('Подтверждаю передачу состава проверенных коробов').check();
 await page.getByRole('button',{name:'Передать короба в Ozon',exact:true}).click();
 await page.getByText('Грузоместа подтверждены',{exact:true}).waitFor();assert.equal(uploads,1); const download=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать соответствия коробов (Excel)',exact:true}).click();assert.match((await download).suggestedFilename(),/\.xlsx$/);assert.equal(downloads,1);assert.equal(uploads,1);
 assert.ok(await page.getByRole('button',{name:'Добавить заявку Ozon'}).isDisabled());
 await page.getByRole('button',{name:'Получить этикетки Ozon'}).click();
 await page.getByRole('link',{name:'Открыть этикетки для печати'}).waitFor();
 await page.getByRole('button',{name:'План через API Ozon',exact:true}).click();
 await page.getByText('Разобрать распределение',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS actual bundled multi-order Ozon link: binding, mismatch guard, mapping, confirmation, frozen receipt, labels and legacy mode');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});


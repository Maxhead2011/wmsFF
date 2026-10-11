// TEST: exercise the actual patched Service menu and compiled React graph with synthetic HTTP.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(process.argv[2]),base=path.resolve(process.argv[3]);
const entry=/src="\/assets\/([^"/]+\.js)"/.exec(fs.readFileSync(path.join(root,'index.html'),'utf8'))[1];
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let enabled=true,creates=[],failOnce=true;
  const rows=['11','12'].map(orderId=>({orderId,skuId:'sku',article:'Зима_реглан_черный',size:'M / 46',supplyId:'WB-'+orderId,
   supplierStatus:'confirm',wbStatus:'waiting',free:2,blockers:[],boxes:[
    {boxId:'b1',boxCode:'FFL_LKBBOX_0142',palletCode:'PALET_SORT_1001',free:1},
    {boxId:'b2',boxCode:'FFL_LKBBOX_0143',palletCode:'PALET_SORT_1002',free:1}]}));
  await page.route('http://localhost/**',async route=>{
   const url=new URL(route.request().url()),name=url.pathname.slice(1);
   if(name==='fixture')return route.fulfill({contentType:'text/html',body:'<div id="root" style="display:none"></div><div id="fixture-root"></div>'});
   if(name.startsWith('api/')){
    let data=[];
    if(name==='api/v1/clients')data=[{id:'client',name:'Тестовый клиент',code:'TEST',status:'ACTIVE'}];
    if(name.endsWith('/capabilities')||name.endsWith('/capability'))data={enabled};
    if(name==='api/v1/service/fbs-manual-assembly/options')data={connections:[{id:'cabinet',accountName:'Тестовый кабинет'}],warehouses:[{id:'moscow',name:'Москва'}]};
    if(name==='api/v1/service/fbs-manual-assembly/preview')data={token:'stable-token',canCreate:true,rows,expiresAt:new Date(Date.now()+600000).toISOString()};
    if(name==='api/v1/service/fbs-manual-assembly/create'){
     creates.push(route.request().postDataJSON());
     if(failOnce){failOnce=false;return route.fulfill({status:503,json:{message:'Ответ потерян'}});}
     data={request:{id:'request',number:1922,status:'IN_WORK'},alreadyCreated:true};
    }
    return route.fulfill({json:data});
   }
   const file=[path.join(root,name),path.join(base,name)].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());
   if(!file)return route.abort();let body=fs.readFileSync(file);
   if(name==='assets/'+entry)body=body.toString()+'\nexport {x as TestReact,ws as TestDom,RF as TestService};';
   return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html',body});
  });
  async function mount(role='OWNER'){
   await page.goto('http://localhost/fixture');
   await page.evaluate(async({entry,role})=>{
    const m=await import('/assets/'+entry);
    m.TestDom.createRoot(document.getElementById('fixture-root')).render(m.TestReact.createElement(m.TestService,{session:{accessToken:'synthetic',tokenType:'Bearer',user:{id:'u',name:'TEST',email:'test@example.invalid',roleCodes:[role],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:'moscow'}}}));
   },{entry,role});
  }
  await mount();
  await page.getByRole('button',{name:'Сборка ФБС по номерам',exact:true}).click();
  await page.getByLabel('Номера заказов').fill('11\n12');
  await page.getByRole('button',{name:'Проверить заказы и остатки'}).click();
  const create=page.getByRole('button',{name:'Создать заявку ФБС'});await create.waitFor();
  assert.equal(await page.getByLabel('Короб для заказа 11').inputValue(),'b1');
  assert.equal(await page.getByLabel('Короб для заказа 12').inputValue(),'b2');
  await page.getByLabel('Короб для заказа 12').selectOption('b1');assert(await create.isDisabled());
  await page.getByLabel('Короб для заказа 12').selectOption('b2');
  await create.evaluate(b=>{b.click();b.click();});await page.getByText(/Ответ потерян/).waitFor();assert.equal(creates.length,1);
  await create.click();await page.getByText(/Заявка №1922 уже создана/).waitFor();assert.deepEqual(creates[0],creates[1]);
  await page.getByRole('button',{name:'← Все сервисы'}).click();
  for(const label of ['Проверка печати WB','Остатки','Заявки'])assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),1);
  // Every lazy module must still load against the single original React owner.
  const modules=fs.readdirSync(path.join(root,'assets')).filter(n=>n.endsWith('.js'));
  await page.evaluate(async names=>{for(const name of names)await import('/assets/'+name);},modules);
  enabled=false;await mount();await page.getByRole('button',{name:'Сборка ФБС по номерам',exact:true}).click();
  await page.getByText('Функция не включена или недоступна вашей роли.').waitFor();
  await mount('MANAGER');await page.getByRole('button',{name:'Проверка печати WB',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Сборка ФБС по номерам',exact:true}).count(),0);
  assert.deepEqual(errors,[]);console.log('PASS actual Service menu, shared stock, retry, role/flag gates and all '+modules.length+' graph modules');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

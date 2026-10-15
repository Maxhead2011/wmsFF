// TEST: actual release graph and published styles; every API operation is mocked.
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');

const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const fs=require('fs'),ts=require('../../../node_modules/typescript');
 const root=process.argv[2],base=process.argv[3]||root;
 const file=n=>{const p=path.join(root,n);return fs.existsSync(p)?p:path.join(base,n)};
 const html=fs.readFileSync(file('index.html'),'utf8');
 const entry=/src="\/assets\/([^"/]+\.js)"/.exec(html)[1];
 const chunk=fs.readdirSync(path.join(root,'assets')).find(n=>n.endsWith('.js')&&fs.readFileSync(path.join(root,'assets',n),'utf8').includes('var __OzonEntry='));assert(chunk);
 const links=(html.match(/<link[^>]*rel="stylesheet"[^>]*>/g)||[]).join('')+fs.readdirSync(path.join(base,'assets')).filter(n=>n.startsWith('OzonFboPanel-')&&n.endsWith('.css')).map(n=>'<link rel="stylesheet" href="/assets/'+n+'">').join('');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const supplies=[{id:'s1',name:'Москва, МО и Дальние регионы',items:[{barcode:'123',quantity:5}]},{id:'s2',name:'Санкт-Петербург и СЗО',items:[{barcode:'456',quantity:5}]}];
 const data={requestId:'r1',connections:[{id:'a1',accountName:null,sellerId:'3308562'}],directions:supplies.map(s=>({name:s.name,items:s.items})),differences:[],packingError:'',link:{connectionId:'a1',orderId:'o1',orderNumber:'132780954-1',place:'МОСКВА_8021',date:'2026-10-12',state:'READY_TO_SUPPLY',mapping:{[supplies[0].name]:'s1',[supplies[1].name]:'s2'},supplies,operations:{}}};
 try{const page=await browser.newPage();const errors=[],calls=[];let delayFirst=false;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url());calls.push({path:u.pathname,query:u.search,body:route.request().postData()});let value=[];
 if(u.pathname.endsWith('/clients'))value=[{id:'c1',code:'CL-000004',name:'ИП Королева О. А.',status:'ACTIVE'},{id:'c2',code:'CL-000002',name:'Второй клиент',status:'ACTIVE'}];
 else if(u.pathname.endsWith('/capability'))value={enabled:true};
 else if(u.pathname.endsWith('/warehouses'))value=u.searchParams.get('clientId')==='c2'?[{id:'w2',name:'ФФ Казань'},{id:'w3',name:'ФФ Омск'}]:[{id:'w1',name:'ФФ Москва'}];
 else if(u.pathname.endsWith('/link-connections'))value=data.connections;
 else if(u.pathname.endsWith('/fbo'))value={requestId:u.pathname.split('/').at(-2),title:'Сборка '+u.pathname.split('/').at(-2),marketplace:'OZON',phase:'COMPLETED',needed:0,picked:0,packed:0,looseRemaining:0,shortage:0,compositionChanged:false,wholeBoxes:[],lines:[],route:[],boxes:[]};
 else if(u.pathname.includes('/supply'))value=data;
 else if(u.pathname.endsWith('/links/preview'))value={place:'Москва',date:'2026-10-12',directions:[],orders:[],totalQuantity:10,previewHash:'h'};
 else if(u.pathname.endsWith('/requests'))value=u.searchParams.get('view')==='completed'?[]:Array.from({length:6},(_,i)=>({id:'r'+(i+1),number:1952+i,title:'ФБО Ozon · 132780954-'+(i+1),quantity:10,directions:2,destinationCity:'МОСКВА_8021',desiredDate:'2026-10-12',phase:'COMPLETED',status:'IN_PROGRESS'}));
 if(delayFirst&&u.pathname.endsWith('/r1/fbo'))await new Promise(r=>setTimeout(r,500));await route.fulfill({contentType:'application/json',body:JSON.stringify(value)});});
 await page.route('http://localhost/**',async route=>{
 const n=new URL(route.request().url()).pathname.slice(1);if(n.startsWith('api/'))return route.fallback();
 if(n==='fixture')return route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width, initial-scale=1">'+links+'</head><body style="margin:0;padding:12px"><div id="root" style="display:none"></div><div id="fixture-root"></div></body></html>'});
 const f=file(n);if(!fs.existsSync(f))return route.abort();let body=fs.readFileSync(f);
 if(n==='assets/'+entry)body=body.toString()+'\nexport {x as TestReact,ws as TestDom};';
 if(n==='assets/'+chunk){body=body.toString();const sf=ts.createSourceFile(n,body,99,true);const node=sf.statements.find(x=>ts.isVariableStatement(x)&&x.declarationList.declarations.some(d=>d.name.getText(sf)==='__OzonEntry'));assert(node);body=body.slice(0,node.end)+';globalThis.layoutWorkspace=__OzonEntry.OzonCustomerWorkspace;'+body.slice(node.end);}
 return route.fulfill({contentType:n.endsWith('.css')?'text/css':n.endsWith('.js')?'application/javascript':'application/octet-stream',body});});
 await page.goto('http://localhost/fixture');await page.evaluate(async({entry,chunk})=>{window.main=await import('/assets/'+entry);await import('/assets/'+chunk);main.TestDom.createRoot(document.getElementById('fixture-root')).render(main.TestReact.createElement(globalThis.layoutWorkspace,{session:{accessToken:'fixture',user:{id:'fixture'}}}));},{entry,chunk});
 await page.getByRole('button',{name:'Поставка и грузоместа Ozon',exact:true}).first().waitFor();
 // TEST: closed composer still selects the branch and loads all orders.
 assert.equal(await page.locator('.ozfbo-workspace-order').count(),6);
 assert.equal(await page.locator('input[type=file]').isVisible(),false);
 assert.equal(await page.locator('.ozfbo-link-import').isVisible(),false);
 for(const theme of ['default','dark','light']){
  await page.evaluate(theme=>{const e=document.documentElement;e.dataset.uiTheme=theme==='default'?'classic':'modern';e.dataset.uiVariant=theme==='default'?'default':'la_panthera';e.dataset.uiStyle=theme},theme);
  for(const width of [1920,1440,1024,736,390,320]){
   await page.setViewportSize({width,height:1000});
   for(const columns of [4,5,6]){
    await page.getByLabel('Плиток в ряд').selectOption(String(columns));
    const dims=await page.evaluate(()=>{const cards=[...document.querySelectorAll('.ozfbo-workspace-order')].map(e=>e.getBoundingClientRect());return{count:cards.filter(e=>Math.abs(e.top-cards[0].top)<2).length,overflow:document.documentElement.scrollWidth>innerWidth};});
    assert.equal(dims.overflow,false,JSON.stringify({theme,width,columns,...dims}));
    if(width>=1440)assert.equal(dims.count,columns);
    if(width<=390)assert.equal(dims.count,1);
   }
  }
 }
 await page.setViewportSize({width:1600,height:1100});
 await page.getByRole('button',{name:'Создать сборку',exact:true}).click();
 const link=page.getByRole('region',{name:'Создать сборку по ссылке Ozon'});
 await link.locator('textarea').fill('https://seller.ozon.ru/app/supply/orders/123');
 await page.getByRole('button',{name:'Из файла',exact:true}).click();
 await page.getByLabel('Название общей сборки',{exact:true}).fill('Черновик Катерины');
 const picked=page.waitForEvent('filechooser');await page.locator('input[type=file]').click();const chooser=await picked;await chooser.setFiles({name:'Поставка.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('fixture')});
 await page.getByRole('button',{name:'Скрыть создание',exact:true}).click();
 await page.getByRole('button',{name:'Создать сборку',exact:true}).click();
 assert.equal(await page.getByLabel('Название общей сборки',{exact:true}).inputValue(),'Черновик Катерины');
 assert.equal(await page.locator('input[type=file]').evaluate(e=>e.files[0].name),'Поставка.xlsx');
 await page.getByRole('button',{name:'По ссылке Ozon',exact:true}).click();
 assert.equal(await link.locator('textarea').inputValue(),'https://seller.ozon.ru/app/supply/orders/123');
 await link.getByRole('button',{name:'Получить состав из Ozon'}).click();
 await link.getByRole('button',{name:'Создать сборку',exact:true}).waitFor();
 const preview=calls.find(c=>c.path.endsWith('/links/preview'));assert.equal(JSON.parse(preview.body).warehouseId,'w1');
 await page.getByRole('button',{name:'Скрыть создание',exact:true}).click();
 // TEST: latest selected order wins despite out-of-order network responses.
 delayFirst=true;
 await page.getByRole('button',{name:'Открыть сборку',exact:true}).first().click();
 await page.getByRole('button',{name:'Открыть сборку',exact:true}).nth(1).click();
 const execution=page.getByRole('region',{name:'Двухэтапная сборка ФБО',exact:true});
 await execution.getByRole('heading',{name:/Сборка r2/}).waitFor();
 await page.waitForTimeout(650);
 assert.equal(await execution.getByRole('heading',{name:/Сборка r2/}).count(),1);
 assert.equal(await page.locator('.online-execution-modal').count(),0);
 const positions=await page.evaluate(()=>({detail:document.querySelector('.ozfbo-selected-detail').getBoundingClientRect().top,orders:document.querySelector('.ozfbo-plans').getBoundingClientRect().bottom}));assert(positions.detail>=positions.orders);
 // TEST: switching to cargo also invalidates pending assembly requests.
 await page.getByRole('button',{name:'Открыть сборку',exact:true}).first().click();
 await page.locator('.ozfbo-workspace-order').nth(1).getByRole('button',{name:'Поставка и грузоместа Ozon',exact:true}).click();
 const panel=page.getByRole('region',{name:'Связь сборки с Ozon'});await panel.getByText('Состав файла совпадает с Ozon.').waitFor();
 await page.waitForTimeout(650);assert.equal(await execution.count(),0);
 assert.equal(await panel.getByRole('button',{name:'Передать короба в Ozon'}).isDisabled(),true);
 await panel.getByRole('checkbox').check();assert.equal(await panel.getByRole('button',{name:'Передать короба в Ozon'}).isEnabled(),true);
 await panel.getByRole('button',{name:'Повторно сверить с Ozon'}).click();await panel.getByText('Данные обновлены.').waitFor();assert.equal(await panel.getByRole('checkbox').isChecked(),false);
 for(const width of [1600,390,320]){await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'detail overflow '+width);}
 if(process.env.LAYOUT_SCREENSHOT){await page.setViewportSize({width:1600,height:1100});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:process.env.LAYOUT_SCREENSHOT,fullPage:true});}
 await page.getByRole('button',{name:'Завершённые',exact:true}).click();await page.getByText('Завершённых сборок пока нет.').waitFor();assert.equal(await page.locator('.ozfbo-selected-detail').count(),0);
 // TEST: changing client and branch clears details and never fetches unscoped orders.
 await page.getByRole('button',{name:'Активные',exact:true}).click();
 await page.locator('.ozfbo-workspace-order').first().waitFor();
 await page.getByRole('button',{name:'Открыть сборку',exact:true}).nth(1).click();
 await execution.waitFor();
 await page.locator('.ozfbo-create-toolbar .ozfbo-client-picker select').selectOption('c2');
 await page.locator('.ozfbo-create-toolbar > label:not(.ozfbo-client-picker) select').selectOption('w2');
 await page.locator('.ozfbo-workspace-order').first().waitFor();
 assert.equal(await page.locator('.ozfbo-selected-detail').count(),0);
 const requestCalls=calls.filter(c=>c.path.endsWith('/requests'));
 assert(requestCalls.every(c=>new URLSearchParams(c.query).get('warehouseId')));assert(requestCalls.some(c=>new URLSearchParams(c.query).get('clientId')==='c2'&&new URLSearchParams(c.query).get('warehouseId')==='w2'));
 assert(!calls.some(c=>c.path.endsWith('/upload')||c.path.endsWith('/commit')));assert.deepEqual(errors,[]);
 console.log('PASS: 4/5/6 tiles, responsive 6 widths x3 themes; closed composer loads orders; drafts preserved; latest-order race; single details below grid; cargo guards; completed reset; no writes');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

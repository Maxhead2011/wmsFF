// TEST: real React/CSS at desktop and phone widths; all API traffic is mocked.
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const web=path.resolve(__dirname,'../../apps/web');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const {createServer}=await import(pathToFileURL(path.join(web,'node_modules/vite/dist/node/index.js')).href);
 const server=await createServer({root:web,configFile:false,server:{host:'127.0.0.1',port:0},esbuild:{jsx:'automatic'},plugins:[{name:'layout-fixture',configureServer(s){s.middlewares.use('/__layout',async (_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__layout',`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:12px"><div id="fixture"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import {OzonCustomerWorkspace} from '/src/components/ozon-fbo/OzonCustomerWorkspace.tsx';import '/src/styles.css';import '/src/components/ozon-fbo/ozon-fbo.css';import '/src/components/layout/la-panthera-theme.css';import '/src/components/layout/la-panthera-light.css';import '/src/components/layout/la-panthera-light-tuning.css';createRoot(document.getElementById('fixture')).render(React.createElement(OzonCustomerWorkspace,{session:{accessToken:'fixture',user:{id:'fixture'}}}));</script></body></html>`));});}}]});
 await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
 const supplies=[{id:'s1',name:'Москва, МО и Дальние регионы',items:[{barcode:'123',quantity:5}]},{id:'s2',name:'Санкт-Петербург и СЗО',items:[{barcode:'456',quantity:5}]}];
 const data={requestId:'r1',connections:[{id:'a1',accountName:null,sellerId:'3308562'}],directions:supplies.map(s=>({name:s.name,items:s.items})),differences:[],packingError:'',link:{connectionId:'a1',orderId:'o1',orderNumber:'132780954-1',place:'МОСКВА_8021',date:'2026-10-12',state:'READY_TO_SUPPLY',mapping:{[supplies[0].name]:'s1',[supplies[1].name]:'s2'},supplies,operations:{}}};
 try{const page=await browser.newPage();const errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url());calls.push({path:u.pathname,body:route.request().postData()});let value=[];
 if(u.pathname.endsWith('/clients'))value=[{id:'c1',code:'CL-000004',name:'ИП Королева О. А.',status:'ACTIVE'}];
 else if(u.pathname.endsWith('/capability'))value={enabled:true};
 else if(u.pathname.endsWith('/warehouses'))value=[{id:'w1',name:'ФФ Москва'}];
 else if(u.pathname.endsWith('/link-connections'))value=data.connections;
 else if(u.pathname.endsWith('/fbo'))value={requestId:u.pathname.split('/').at(-2),title:'Сборка '+u.pathname.split('/').at(-2),marketplace:'OZON',phase:'COMPLETED',needed:0,picked:0,packed:0,looseRemaining:0,shortage:0,compositionChanged:false,wholeBoxes:[],lines:[],route:[],boxes:[]};
 else if(u.pathname.includes('/supply'))value=data;
 else if(u.pathname.endsWith('/links/preview'))value={place:'Москва',date:'2026-10-12',directions:[],orders:[],totalQuantity:10,previewHash:'h'};
 else if(u.pathname.endsWith('/requests'))value=u.searchParams.get('view')==='completed'?[]:Array.from({length:5},(_,i)=>({id:'r'+(i+1),number:1952+i,title:'ФБО Ozon · 132780954-'+(i+1),quantity:10,directions:2,destinationCity:'МОСКВА_8021',desiredDate:'2026-10-12',phase:'COMPLETED',status:'IN_PROGRESS'}));
 await route.fulfill({contentType:'application/json',body:JSON.stringify(value)});});
 await page.goto(server.resolvedUrls.local[0]+'__layout');
 await page.getByRole('button',{name:'Поставка и грузоместа Ozon',exact:true}).first().waitFor();
 for(const theme of ['default','dark','light']){await page.evaluate(theme=>{const e=document.documentElement;e.dataset.uiTheme=theme==='default'?'classic':'modern';e.dataset.uiVariant=theme==='default'?'default':'la_panthera';e.dataset.uiStyle=theme},theme);for(const width of [1440,1024,736,390,320]){await page.setViewportSize({width,height:1200});await page.waitForTimeout(80);const dims=await page.evaluate(()=>{const a=document.querySelector('.ozfbo-import').getBoundingClientRect(),b=document.querySelector('.ozfbo-plans').getBoundingClientRect();return{a:a.width,b:b.width,topA:a.top,topB:b.top,overflow:document.documentElement.scrollWidth>innerWidth}});assert.equal(dims.overflow,false,'overflow '+width);if(width>=1024){assert(Math.abs(dims.a/(dims.a+dims.b)-.65)<.01);assert(Math.abs(dims.topA-dims.topB)<2)}else assert(dims.topB>dims.topA);}}
 // TEST: five assemblies grow with the document; no clipped inner scroll area.
 const compact=await page.evaluate(()=>{const list=document.querySelector('.ozfbo-plan-list'),style=getComputedStyle(list),fields=getComputedStyle(document.querySelector('.ozfbo-import-fields')),file=getComputedStyle(document.querySelector('input[type=file]'),'::file-selector-button'),download=getComputedStyle(document.querySelector('.ozfbo-upload-row a'));return {count:list.children.length,height:list.clientHeight,scroll:list.scrollHeight,max:style.maxHeight,overflow:style.overflowY,gap:parseFloat(fields.rowGap),fileRadius:parseFloat(file.borderTopLeftRadius),linkDecoration:download.textDecorationLine}});
 assert.equal(compact.count,5);assert.equal(compact.max,'none');assert.equal(compact.overflow,'visible');assert(compact.scroll<=compact.height+1);assert(compact.gap<=10);assert(compact.fileRadius>=8);assert.equal(compact.linkDecoration,'none');
 // TEST: opening, switching and closing embedded assembly keeps the list usable.
 await page.setViewportSize({width:1440,height:1200});
 await page.getByRole('button',{name:'Открыть сборку',exact:true}).first().click();
 const execution=page.getByRole('region',{name:'Двухэтапная сборка ФБО',exact:true});
 await execution.getByRole('heading',{name:/Сборка r1/}).waitFor();
 assert.equal(await page.locator('.online-execution-modal').count(),0);
 assert.equal(await execution.locator('xpath=..').getAttribute('class'),'ozfbo-workspace-left');
 const position=await page.evaluate(()=>({panel:document.querySelector('.fbo-inline-execution').getBoundingClientRect().top,form:document.querySelector('.ozfbo-import').getBoundingClientRect().bottom}));
 assert(position.panel>=position.form);
 await page.getByRole('button',{name:'Открыть сборку',exact:true}).nth(1).click();
 await execution.getByRole('heading',{name:/Сборка r2/}).waitFor();
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1200});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'inline overflow '+width);}
 await execution.getByRole('button',{name:'Закрыть',exact:true}).first().click();
 await execution.waitFor({state:'detached'});
 await page.getByRole('button',{name:'Открыть сборку',exact:true}).first().waitFor();
 const picked=page.waitForEvent('filechooser');await page.locator('input[type=file]').click();const chooser=await picked;await chooser.setFiles({name:'Приёмка.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('fixture')});assert.equal(await page.locator('input[type=file]').evaluate(e=>e.files[0].name),'Приёмка.xlsx');assert.equal(await page.locator('.ozfbo-upload-row a').getAttribute('download'),'Шаблон-ФБО-Ozon.xlsx');
 await page.getByRole('button',{name:'Поставка и грузоместа Ozon',exact:true}).first().click();const panel=page.getByRole('region',{name:'Связь сборки с Ozon'});await panel.getByText('Состав файла совпадает с Ozon.').waitFor();
 assert.equal(await panel.getByRole('button',{name:'Передать короба в Ozon'}).isDisabled(),true);
 assert.equal(await panel.getByRole('button',{name:'Скачать соответствия коробов (Excel)'}).isDisabled(),true);
 assert.match(await panel.locator('select').first().textContent(),/ИП Королева О. А. · 3308562/);
 await panel.getByRole('checkbox').check();assert.equal(await panel.getByRole('button',{name:'Передать короба в Ozon'}).isEnabled(),true);
 await panel.getByRole('button',{name:'Повторно сверить с Ozon'}).click();await panel.getByText('Данные обновлены.').waitFor();assert.equal(await panel.getByRole('checkbox').isChecked(),false);
 for(const width of [1024,320]){await page.setViewportSize({width,height:1200});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'supply overflow '+width);}
 const link=page.getByRole('region',{name:'Создать сборку по ссылке Ozon'});await link.locator('textarea').fill('https://seller.ozon.ru/app/supply/orders/123');await link.getByRole('button',{name:'Получить состав из Ozon'}).click();await link.getByRole('button',{name:'Создать сборку',exact:true}).waitFor();const preview=calls.find(c=>c.path.endsWith('/links/preview'));assert.equal(JSON.parse(preview.body).warehouseId,'w1');assert.equal(JSON.parse(preview.body).connectionId,'a1');
 if(process.env.LAYOUT_SCREENSHOT){await page.setViewportSize({width:1280,height:1200});await page.screenshot({path:process.env.LAYOUT_SCREENSHOT,fullPage:true});}
 await page.getByRole('button',{name:'Завершённые',exact:true}).click();await page.getByText('Завершённых сборок пока нет.').waitFor();assert(!calls.some(c=>c.path.endsWith('/upload')||c.path.endsWith('/create')));assert.deepEqual(errors,[]);
 console.log('PASS: 65/35 desktop; 736/390/320 stacking; no overflow; owner label; import scope; cargo/confirm guards; completed list; no write calls');
 }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

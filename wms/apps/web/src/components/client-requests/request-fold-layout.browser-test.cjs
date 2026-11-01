// TEST: actual request panel layout, native disclosures and searches at two widths.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const esbuild=require(process.env.ESBUILD_MODULE||'esbuild');
test('header first, three independent folds and compact request search',async()=>{
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {ClientRequestsPanel} from './ClientRequestsPanel';
 import '../../styles.css';
 createRoot(document.getElementById('root')).render(<ClientRequestsPanel session={{accessToken:'fixture',user:{id:'test',name:'Test',roleCodes:['MANAGER'],permissionCodes:['client-requests:read','client-requests:write','stock:read'],clientIds:[],writableClientIds:[],warehouseIds:[],writableWarehouseIds:[]}}} onOpenFbsOrders={()=>{}}/>);`;
 const bundle=await esbuild.build({stdin:{contents:entry,loader:'tsx',resolveDir:__dirname},outfile:'test.js',bundle:true,write:false,jsx:'automatic',external:['/cursors/*','*.woff2','*.svg','*.woff','*.png'],define:{'import.meta.env':JSON.stringify({}), 'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:850}});page.setDefaultTimeout(6000);
 const client={id:'c',code:'CL-000001',name:'Тестовый клиент'};
 const row={id:'r',number:2564,status:'IN_WORK',type:'OUTBOUND',title:'FBS — 1 заказ',priority:'NORMAL',clientId:'c',client,items:[],files:[],packages:[],_count:{fbsOrderLinks:1},createdAt:'2026-11-01'};
 let searches=0;const errors=[];page.on('pageerror',e=>errors.push(e.stack));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html lang="ru"><div id="root"></div></html>'});
 let data=[];if(url.pathname.endsWith('/ozon-fbo-import/capability'))data={enabled:true};if(url.pathname.endsWith('/client-requests'))data=[row];if(url.pathname.endsWith('/clients'))data=[client];
 if(url.pathname.endsWith('/operations-tools/requests')){searches++;data={rows:[],truncated:false};}
 return route.fulfill({json:data});});await page.goto('http://fixture.test');
 await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.css')).text});
 await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
 const panel=page.locator('section.client-requests-panel').first(),folds=panel.locator(':scope > details.request-fold');
 try{await folds.nth(2).waitFor();}catch(e){throw Error(errors.join('|')+' '+(await page.locator('body').innerText()).slice(0,1200)+' '+e.message);}
 assert(await panel.locator(':scope > :first-child').evaluate(el=>el.classList.contains('client-requests-panel__heading')));
 assert.deepEqual(await folds.locator(':scope > summary').allTextContents(),['Проверки и поиск','Сборка из Excel','Новая заявка из хвостов FBS']);
 assert.equal(await panel.locator(':scope > details.request-fold[open]').count(),0);
 // TEST: both Ozon methods belong inside Excel and keep drafts across disclosure toggles.
 const excel=folds.nth(1), excelTitle=excel.locator(':scope > summary');
 const ozon=panel.locator('.ozfbo-customer-import');await ozon.waitFor({state:'attached'});
 assert.equal(await excel.locator('.ozfbo-customer-import').count(),1);
 await excelTitle.click();
 const fileFold=ozon.locator('details').filter({has:page.locator('summary',{hasText:'файл клиента по направлениям'})});
 const linkFold=ozon.locator('details').filter({has:page.locator('summary',{hasText:'Создать сборку по ссылке Ozon'})});
 assert.equal(await fileFold.count(),1);assert.equal(await linkFold.count(),1);
 assert.equal(await fileFold.getAttribute('open'),null);assert.equal(await linkFold.getAttribute('open'),null);
 await fileFold.locator('summary').click();await fileFold.locator('select:has(option[value="c"])').selectOption('c');await fileFold.locator('summary').click();
 await linkFold.locator('summary').click();const link=linkFold.getByLabel('Ссылка на заявку Ozon');await link.fill('https://seller.ozon.ru/app/supply/orders/12345');
 await linkFold.locator('summary').click();assert.equal(await link.isVisible(),false);
 await excelTitle.click();await excelTitle.click();await linkFold.locator('summary').click();assert.equal(await link.inputValue(),'https://seller.ozon.ru/app/supply/orders/12345');
 await excelTitle.click();
 const tail=folds.nth(2);await tail.locator('summary').focus();await page.keyboard.press('Enter');await tail.getByRole('combobox').waitFor();
 assert(await tail.getByRole('button',{name:'Показать, что будет перенесено'}).isDisabled());await tail.locator('summary').click();
 const tools=folds.first();await tools.locator('summary').click();const input=tools.locator('input'),button=tools.getByRole('button',{name:'Проверить',exact:true});assert(await button.isDisabled());const a=await input.boundingBox(),b=await button.boundingBox();
 assert(a.width<=200&&b.x-a.x-a.width<18&&Math.abs((b.y+b.height)-(a.y+a.height))<3);
 if(process.env.REQUEST_FOLDS_PREVIEW){
   const top=await panel.locator(':scope > :first-child').boundingBox(),bottom=await tail.boundingBox();
   await page.screenshot({path:process.env.REQUEST_FOLDS_PREVIEW,clip:{x:top.x,y:top.y,width:top.width,height:bottom.y+bottom.height-top.y}});
 }
 await input.fill('2564');await input.press('Enter');await tools.getByText('По выбранным условиям ничего не найдено.').waitFor();assert.equal(searches,1);
 await tools.getByRole('tab',{name:'Точный поиск'}).click();assert((await input.boundingBox()).width>a.width);
 await page.setViewportSize({width:360,height:800});assert(await tools.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const web = path.resolve(__dirname, '../../../apps/web');
const esbuild = require('node:module').createRequire(require.resolve(web + '/node_modules/vite/package.json'))('esbuild');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
// TEST: receipt history, closure and archive through the React panel with synthetic API responses.
(async () => {
 const script=esbuild.buildSync({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import {KizCheckPanel} from './src/components/kiz/KizCheckPanel';createRoot(document.getElementById('root')).render(<KizCheckPanel session={{accessToken:'test',user:{id:'admin'}}}/>);",resolveDir:web,loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'import.meta.env':JSON.stringify({VITE_KIZ_REVIEW_QUEUE_ENABLED:'true',VITE_KIZ_CLIENT_GUARD_ENABLED:'true',VITE_KIZ_FOUND_REVIEW_ENABLED:'true'})}}).outputFiles[0].text;
 const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const row={id:'r',kizIdentity:'TEST',status:'OPEN',active:true,attempts:1,createdAt:new Date().toISOString(),snapshot:{scope:'RECEIPT',productName:'Товар',receiptInfo:{firstScanBox:'BOX-1',repeatScanBox:'BOX-2',firstScanAt:'2026-11-01T08:10:00Z',repeatScanAt:'2026-11-01T08:12:00Z'}}};let closed=false,writes=0;
 await page.route('**/*',async route=>{const u=new URL(route.request().url()),p=u.pathname;
 if(p==='/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
 if(p.endsWith('/reviews'))return route.fulfill({json:{items:closed===(u.searchParams.get('status')==='CLOSED')?[closed?{...row,status:'CLOSED',resolution:'CLOSE',active:false,reason:'Ошибка сканирования',decidedByName:'Test Admin'}:row]:[],nextCursor:null}});
 if(p.endsWith('/kiz-found'))return route.fulfill({json:[]});
 if(p.endsWith('/check'))return route.fulfill({json:{found:true,identity:'TEST',matches:[],reviews:[{id:'unit:m',kizIdentity:'TEST',status:'OPEN',decision:'REVIEW',active:true,snapshot:{scope:'UNIT',productName:'Проверочная единица'}}]}});
 if(p.endsWith('/decision')){const b=route.request().postDataJSON();assert.equal(b.resolution,'CLOSE');assert.equal(b.reason,'Ошибка сканирования');assert(b.confirmed);closed=true;writes++;return route.fulfill({json:{status:'CLOSED'}});}
 return route.abort();});
 await page.goto('https://fixture.test/');await page.addScriptTag({content:script});await page.addStyleTag({content:fs.readFileSync(web+'/src/components/kiz/kiz.css','utf8')});
 await page.locator('details.kiz-review-case > summary').click();
 await page.getByText('Повтор в другом коробе',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'КИЗы, найденные после отгрузки'}).count(),1);
 // TEST: receipt decisions and scan evidence retain the approved card layout.
 const receipt=page.locator('details.kiz-review-case[open]');
 await receipt.getByRole('heading',{name:'Решение по обращению'}).waitFor({timeout:2000});
 const cardBounds=await receipt.boundingBox();
 assert(cardBounds.width<=920);
 const titleBounds=await receipt.locator('summary').boundingBox();
 const timelineBounds=await receipt.locator('.kiz-scan-timeline').boundingBox();
 assert(Math.abs(titleBounds.x-timelineBounds.x)<1);
 assert(Math.abs(cardBounds.x-(page.viewportSize().width-cardBounds.width)/2)<2);

 const band=receipt.locator('.kiz-scan-band').first();
 assert.equal(await band.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(248, 247, 250)');
 if(process.env.KIZ_PREVIEW)await receipt.screenshot({path:process.env.KIZ_PREVIEW});
 const history=page.getByRole('button',{name:'Посмотреть историю КИЗа'});await history.click();let modal=page.getByRole('dialog',{name:'История КИЗа'});await modal.getByText(/BOX-1/).waitFor();await modal.getByText(/BOX-2/).waitFor();await page.keyboard.press('Escape');assert(await history.evaluate(n=>document.activeElement===n));
 await page.getByRole('button',{name:'Закрыть обращение',exact:true}).click();modal=page.getByRole('dialog');await modal.getByRole('checkbox').check();await modal.getByRole('button',{name:'Подтвердить решение'}).click();await page.getByText(/Обращение закрыто/).waitFor();assert.equal(writes,1);
 await page.getByRole('button',{name:'Закрытые ошибки сканирования'}).click();await page.locator('details.kiz-review-case > summary').click();await page.getByText(/Test Admin/).waitFor();await page.getByRole('button',{name:'На проверке',exact:true}).click();
 await page.getByLabel('КИЗ',{exact:true}).fill('TEST');await page.getByRole('button',{name:'Проверить',exact:true}).click();
 const unit=page.locator('details').filter({hasText:'Проверочная единица'});await unit.locator('summary').click();
 assert(await unit.getByRole('button',{name:'Разрешить использовать'}).isEnabled());
 await unit.getByRole('button',{name:'Разрешить переклейку'}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Отмена'}).click();
 assert.deepEqual(errors,[]);console.log('PASS timeline, single found panel, modal, focus return, close and archive');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

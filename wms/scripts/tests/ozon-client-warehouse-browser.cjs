// TEST: real React components, branch selection and multipart imports in a browser.
const path=require('path'),fs=require('fs'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),web=path.join(root,'apps/web');
const esbuild=require(path.join(root,'node_modules/.pnpm',fs.readdirSync(path.join(root,'node_modules/.pnpm')).find(n=>n.startsWith('esbuild@0.25.')),'node_modules/esbuild'));
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const build=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OzonCustomerWorkspace} from './src/components/ozon-fbo/OzonCustomerWorkspace';createRoot(document.getElementById('root')).render(<OzonCustomerWorkspace session={{accessToken:'test',user:{id:'test',roleCodes:['CLIENT'],clientIds:['one','many','none']}}}/>);`,resolveDir:web,loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"test"'},loader:{'.css':'empty'}});
 const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage();const errors=[],imports=[],lists=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.route('http://localhost/**',async route=>{const url=new URL(route.request().url()),n=url.pathname;
 if(n==='/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/app.js"></script>'});
 if(n==='/app.js')return route.fulfill({contentType:'application/javascript',body:build.outputFiles[0].text});
 let data=[];
 if(n.endsWith('/clients'))data=['one','many','none'].map(id=>({id,name:id,code:id,status:'ACTIVE'}));
 if(n.endsWith('/capability'))data={enabled:true};
 if(n.endsWith('/warehouses'))data=url.searchParams.get('clientId')==='one'?[{id:'moscow',name:'ФФ Москва'}]:url.searchParams.get('clientId')==='many'?[{id:'a',name:'A'},{id:'b',name:'B'}]:[];
 if(n.endsWith('/requests')){lists.push(Object.fromEntries(url.searchParams));}
 if(n.endsWith('/preview')||n.endsWith('/commit')){imports.push(route.request().postDataBuffer().toString());data=n.endsWith('/preview')?{totalQuantity:2,directions:[{name:'Москва',items:[{quantity:2}]}]}:{request:{id:'new',number:123},existing:false};}
 return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://localhost/');await page.waitForFunction(()=>document.querySelectorAll('select')[1]?.value==='moscow');
 await page.getByLabel('Место общей отгрузки').fill('Москва');await page.getByLabel('Файл клиента',{exact:true}).setInputFiles({name:'test.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('fixture')});
 await page.getByRole('button',{name:'Проверить файл',exact:true}).click();await page.getByRole('button',{name:'Создать единую сборку',exact:true}).click();await page.getByRole('status').filter({hasText:'Сборка №123'}).waitFor();
 assert.equal(imports.length,2);assert(imports.every(body=>/name="warehouseId"\r\n\r\nmoscow/.test(body)));assert(lists.some(row=>row.clientId==='one'&&row.warehouseId==='moscow'));
 await page.getByRole('combobox').nth(0).selectOption('many');await page.getByRole('combobox').nth(1).locator('option[value="b"]').waitFor({state:'attached'});assert.equal(await page.getByRole('combobox').nth(1).inputValue(),'');
 await page.getByLabel('Место общей отгрузки').fill('Москва');await page.getByLabel('Файл клиента',{exact:true}).setInputFiles({name:'test.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('fixture')});assert(await page.getByRole('button',{name:'Проверить файл',exact:true}).isDisabled());
 await page.getByRole('combobox').nth(1).selectOption('a');await page.getByRole('button',{name:'Проверить файл',exact:true}).click();await page.getByRole('button',{name:'Создать единую сборку',exact:true}).waitFor();await page.getByRole('combobox').nth(1).selectOption('b');assert.equal(await page.getByRole('button',{name:'Создать единую сборку',exact:true}).count(),0);
 await page.getByRole('combobox').nth(0).selectOption('none');await page.getByText('У клиента нет активного филиала.',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Проверить файл',exact:true}).isDisabled());assert.deepEqual(errors,[]);
 console.log('PASS: singleton import/list, explicit multiple branches, preview reset, empty branch, client switch');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

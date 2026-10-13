// TEST: real workspace defaults to active; terminal records remain accessible separately.
const path=require('path'),fs=require('fs'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),web=path.join(root,'apps/web');
const esbuild=require('module').createRequire(fs.realpathSync(path.join(web,'node_modules/vite/package.json')))('esbuild');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const build=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OzonCustomerWorkspace} from './src/components/ozon-fbo/OzonCustomerWorkspace';createRoot(document.getElementById('root')).render(<OzonCustomerWorkspace session={{accessToken:'test',user:{id:'test',roleCodes:['CLIENT'],clientIds:['c']}}}/>);`,resolveDir:web,loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"test"'},loader:{'.css':'empty'}});
 const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage(),errors=[],queries=[];let handedOver=false;
 page.on('pageerror',e=>errors.push(e.message));
 const row=(id,status,phase)=>({id,number:id,title:'fixture-'+id,status,phase,quantity:1,directions:1});
 await page.route('http://localhost/**',async route=>{
  const u=new URL(route.request().url()),n=u.pathname;
  if(n==='/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/app.js"></script>'});
  if(n==='/app.js')return route.fulfill({contentType:'application/javascript',body:build.outputFiles[0].text});
  let data=[];
  if(n.endsWith('/clients'))data=[{id:'c',name:'Client',code:'C',status:'ACTIVE'}];
  if(n.endsWith('/capability'))data={enabled:true};
  if(n.endsWith('/warehouses'))data=[{id:'w',name:'Warehouse'}];
  if(n.endsWith('/requests')){
   queries.push(Object.fromEntries(u.searchParams));
   data=u.searchParams.get('view')==='completed'?[row(2,'DONE','COMPLETED'),row(3,'CANCELLED','NOT_STARTED'),...(handedOver?[row(1,'DONE','COMPLETED')]:[])]:handedOver?[]:[row(1,'PACKED','COMPLETED')];
  }
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://localhost/');await page.getByText('Упаковано, ожидает сдачи',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Активные',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await page.getByText('Сдано',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Завершённые',exact:true}).click();await page.getByText('Сдано',{exact:true}).waitFor();
 await page.getByText('Отменена',{exact:true}).waitFor();assert.equal(await page.getByText('Упаковано, ожидает сдачи',{exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Открыть сборку',exact:true}).count(),2);
 assert.equal(await page.getByRole('button',{name:'Поставка и грузоместа Ozon',exact:true}).count(),2);
 await page.getByRole('button',{name:'Активные',exact:true}).click();await page.getByText('Упаковано, ожидает сдачи',{exact:true}).waitFor();
 handedOver=true;await page.getByRole('button',{name:'Обновить',exact:true}).click();await page.getByText('Активных сборок пока нет.',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Завершённые',exact:true}).click();await page.getByText('№000001 · fixture-1',{exact:true}).waitFor();
 assert(queries.every(q=>q.clientId==='c'&&q.warehouseId==='w'));assert(queries.some(q=>q.view==='active')&&queries.some(q=>q.view==='completed'));assert.deepEqual(errors,[]);
 console.log('PASS: active default, packed remains active, terminal statuses separate, documents/history accessible, handover refresh');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

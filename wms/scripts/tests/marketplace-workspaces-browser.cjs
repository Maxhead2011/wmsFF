// TEST: scoped selectors, customer tiles, staff tiles and Lamoda operational layout.
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const web=path.resolve(__dirname,'../../apps/web');
const names=['marketplace-validation.html','marketplace-validation.tsx'];
for(const n of names) assert(!fs.existsSync(path.join(web,n)));
fs.writeFileSync(path.join(web,names[0]),'<html><meta charset="utf-8"><div id="root"></div><script type="module" src="/marketplace-validation.tsx"></script></html>');
fs.writeFileSync(path.join(web,names[1]),`import React from 'react';import{createRoot}from'react-dom/client';import './src/styles.css';import{FboWorkspace}from'./src/components/client-requests/FboWorkspace';import{FbsPanel}from'./src/components/fbs/FbsPanel';const customer=location.search.includes('client');const session={accessToken:'fixture',tokenType:'Bearer',user:{id:'test',name:'Test',email:'test@example.invalid',roleCodes:[customer?'CLIENT':'OWNER'],permissionCodes:customer?['clients:read','client-requests:read']:['system:admin'],clientIds:['l','o'],writableClientIds:['l','o'],clientScopeMode:'LIMITED'}};createRoot(document.getElementById('root')!).render(location.search.includes('fbs')?<FbsPanel session={session}/>:<FboWorkspace session={session}/>);`);
process.on('exit',()=>names.forEach(n=>fs.rmSync(path.join(web,n),{force:true})));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let checks=0;try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url()),p=u.pathname;assert.equal(q.method(),'GET');let data=[];
 if(p.endsWith('/clients')) {assert.equal(u.searchParams.get('marketplaceDirectory'),'true');data=[{id:'l',name:'Lamoda client',code:'L',lamodaAccounts:[{isActive:true,fboEnabled:true,fbsEnabled:false}],marketplaceConnections:[]},{id:'o',name:'Ozon client',code:'O',lamodaAccounts:[],marketplaceConnections:[{marketplace:'OZON',isActive:false}]},{id:'none',name:'Unconnected',lamodaAccounts:[],marketplaceConnections:[]}];}
 else if(p.endsWith('/lamoda/accounts'))data=[{id:'a',clientId:'l',name:'Shop',sellerId:'123',isActive:true,fboEnabled:true}];
 else if(p.endsWith('/warehouses'))data=[{id:'w',name:'Warehouse'}];
 else if(p.endsWith('/lamoda/accounts/a'))data={products:[],documents:[],exchanges:[],assemblyEnabled:true,plans:[{id:'p',title:'Active plan',createdAt:'2026-10-28',warehouse:{name:'Warehouse'},items:[{quantity:2}],assembly:{requestId:'r',request:{number:1,status:'IN_WORK'}}},{id:'old',title:'Done plan',createdAt:'2026-10-28',warehouse:{name:'Warehouse'},items:[],assembly:{requestId:'d',request:{number:2,status:'DONE'}}}]};
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 const url='http://127.0.0.1:5192/marketplace-validation.html';
 await page.goto(url+'?client');await page.getByRole('button',{name:/FBO Ozon/}).waitFor();assert.equal(await page.locator('.fbo-marketplaces > button').count(),2);checks++;
 await page.goto(url);await page.getByRole('button',{name:/lamoda/}).click();await page.getByText('Active plan',{exact:true}).waitFor();assert.equal(await page.locator('.lamoda-fields select').first().locator('option').count(),2);assert.equal(await page.locator('input[type=password]').count(),0);assert.equal(await page.getByText('Журнал обмена',{exact:true}).count(),0);checks+=3;
 const outer=await page.locator('.lamoda-workspace').boundingBox(),right=await page.locator('.lamoda-operational-list').boundingBox();assert(right.width>outer.width*.9);assert.equal(await page.locator('.lamoda-operational-create').count(),0);checks++;
 assert.equal(await page.getByText('Done plan',{exact:true}).count(),0);await page.getByRole('button',{name:'Завершённые',exact:true}).click();await page.getByText('Done plan',{exact:true}).waitFor();assert.equal(await page.getByText('Active plan',{exact:true}).count(),0);checks++;
 await page.setViewportSize({width:390,height:900});assert.equal(await page.locator('.lamoda-operational-grid').evaluate(e=>getComputedStyle(e).display),'flex');checks++;
 await page.goto(url+'?client&fbs');await page.getByRole('button',{name:/FBS Ozon/}).waitFor();assert.equal(await page.locator('.fbs-marketplace-picker > button').count(),1);checks++;
 await page.goto(url+'?fbs');await page.getByRole('button',{name:/FBS Lamoda/}).waitFor();assert.equal(await page.locator('.fbs-marketplace-picker > button').count(),4);await page.getByRole('button',{name:/FBS Lamoda/}).click();await page.getByRole('heading',{name:'Lamoda · заказы FBS'}).waitFor();assert.equal(await page.getByRole('button',{name:'Планы FBO',exact:true}).count(),0);checks++;
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks,errors}));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

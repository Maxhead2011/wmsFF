const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=process.argv[2],s=fs.readFileSync(process.argv[3]||root+'/web/assets/panthera-sync-20261020.js','utf8'),a=ts.createSourceFile('x',s,99,true);
const features=a.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(a)==='__MainFeatures'));assert(features);
esbuild.buildSync({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';const __WmsReact=React;${features.getText(a)};const user=new URLSearchParams(location.search).get('user')||'alice';createRoot(document.getElementById('root')).render(React.createElement(__MainFeatures.PantheraNavigation,{userId:user,accessToken:user,activeId:'overview',onOpen:()=>{},kizUnread:0,groups:[{id:'main',title:'Main',items:['overview','fbs','warehouse','fbo'].map(id=>({id,title:id,icon:()=>null}))}]}));`,resolveDir:path.resolve(__dirname,'../../../apps/web'),loader:'js'},bundle:true,outfile:root+'/browser.js'});
const server=http.createServer((req,res)=>{if(req.url==='/browser.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(root+'/browser.js'))}res.end('<div id="root"></div><script src="/browser.js"></script>')}).listen(5193,'127.0.0.1');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{
 const values=new Map(),errors=[];let offline=false;
 async function device(local,user='alice'){
  const context=await browser.newContext();await context.addInitScript(({local,user})=>{if(local!==null&&!localStorage.getItem('seeded')){localStorage.setItem('wms.panthera.favorites.'+user,JSON.stringify(local));localStorage.setItem('seeded','yes')}},{local,user});
  await context.route('**/api/v1/auth/me/panthera-favorites',async route=>{
   if(offline)return route.abort('failed');
   const id=route.request().headers().authorization.replace('Bearer ','');let value=values.get(id)||{ids:null,revision:0};
   if(route.request().method()==='POST'){
    const body=route.request().postDataJSON();if(body.revision!==value.revision)return route.fulfill({status:409,json:{}});
    value={ids:body.ids,revision:body.revision+1};values.set(id,value);
   }return route.fulfill({json:value});
  });const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5193/?user='+user);return page;
 }
 const one=await device(['fbs','warehouse']);
 await one.waitForFunction(()=>!document.querySelector('[aria-label="Добавить быструю ссылку"]').disabled);
 assert.deepEqual(values.get('alice')?.ids,['fbs','warehouse']);
 const two=await device(['fbo']);
 const list=p=>p.locator('.workspace-favorites__item > button');
 await two.waitForFunction(()=>document.querySelectorAll('.workspace-favorites__item').length===2);
 assert.deepEqual(await list(two).allTextContents(),['fbs','warehouse']);
 await one.getByRole('button',{name:'Редактировать быстрые ссылки',exact:true}).click();
 await one.getByRole('button',{name:'Убрать быструю ссылку: fbs',exact:true}).click();
 await one.waitForFunction(()=>document.querySelectorAll('.workspace-favorites__item').length===1);
 await two.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await two.waitForFunction(()=>document.querySelectorAll('.workspace-favorites__item').length===1);
 assert.deepEqual(await list(two).allTextContents(),['warehouse']);
 const other=await device(null,'bob');await other.waitForFunction(()=>!document.querySelector('[aria-label="Добавить быструю ссылку"]').disabled);assert.equal(await list(other).count(),0);
 offline=true;await two.evaluate(()=>window.dispatchEvent(new Event('focus')));await two.getByRole('status').waitFor();assert.deepEqual(await list(two).allTextContents(),['warehouse']);offline=false;
 await two.getByRole('button',{name:'Повторить',exact:true}).click();await two.getByRole('status').waitFor({state:'detached'});assert.deepEqual(errors,[]);
 fs.writeFileSync(root+'/browser-proof.json',JSON.stringify({passed:true,devices:3,migration:true,focusSync:true,userIsolation:true,offlineRetainsCache:true}));console.log('PASS three browser contexts and offline recovery');
}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);server.close();process.exitCode=1});

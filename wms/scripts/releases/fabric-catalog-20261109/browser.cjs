'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
// TEST: exercise the real TSX component against synthetic APIs, never production business endpoints.
async function main(){
 const root=path.resolve(__dirname,'../../../..'),web=path.join(root,'wms/apps/web');
 const {build}=require(path.join(web,'node_modules/vite'));
 const work=path.join(root,'release-local/fabric-browser');fs.mkdirSync(work,{recursive:true});
 fs.writeFileSync(path.join(work,'index.html'),'<meta charset="utf-8"><div id="root"></div><script type="module" src="./entry.tsx"></script>');
 fs.writeFileSync(path.join(work,'entry.tsx'),`import React from 'react';import{createRoot}from'react-dom/client';import{FabricWarehousePanel}from'../../wms/apps/web/src/components/warehouse/FabricWarehousePanel';createRoot(document.getElementById('root')!).render(<FabricWarehousePanel session={{accessToken:'synthetic',user:{id:'admin',roleCodes:['ADMIN'],permissionCodes:['system:admin'],activeWarehouseId:'moscow'}} as any}/>);`);
 await build({root,configFile:false,esbuild:{jsx:'automatic'},resolve:{alias:{react:path.join(web,'node_modules/react'),'react-dom':path.join(web,'node_modules/react-dom')}},build:{outDir:path.join(work,'dist'),emptyOutDir:true,rollupOptions:{input:path.join(work,'index.html')}}});
 const dist=path.join(work,'dist');const server=http.createServer((req,res)=>{const url=req.url.split('?')[0];const file=path.join(dist,url==='/'?'release-local/fabric-browser/index.html':url);if(!file.startsWith(dist)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage();page.on('requestfailed',r=>console.error('REQUEST',r.url(),r.failure()));let catalog={version:null,colors:[],baseColors:{black:'Чёрный'},skus:[{id:'sku',name:'Пудровый 5м',internalSku:'offer',marketplace:'WILDBERRIES',productId:'123',offerId:'pink5',barcodes:['123'],binding:null}]};let rolls={enabled:true,version:null,groups:[],history:[]};const commands=[];
 await page.route('**/api/v1/**',async route=>{const req=route.request(),url=new URL(req.url());let body;
  if(url.pathname==='/api/v1/clients')body=[{id:'client',code:'C',name:'Бушкова'}];
  else if(url.pathname.includes('fabric-catalog')){
   if(req.method()==='POST'){const input=req.postDataJSON();commands.push(input);let result={};if(input.action==='CREATE_COLOR'){const color={id:'custom-pink',material:'SATIN',name:input.name};catalog={...catalog,version:'2026-11-09T00:00:00.000Z',colors:[color]};result={color};}else{catalog.skus[0].binding={material:input.material,color:input.colorId,lengthMm:input.lengthMm};}body={result,catalog};}else body=catalog;
  }else if(url.pathname.includes('fabric-rolls')){if(req.method()==='POST'){const input=req.postDataJSON();commands.push(input);rolls={...rolls,version:'2026-11-09T00:01:00.000Z'};}body=rolls;}
  else throw Error('Unexpected synthetic request '+url.pathname);
  await route.fulfill({json:body});
 });
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message);});page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text());});await page.goto(`http://127.0.0.1:${server.address().port}/`);
 console.log('BODY',await page.locator('body').innerText());
 await page.getByRole('combobox',{name:/^Клиент/}).selectOption('client');await page.getByLabel('Новый цвет',{exact:true}).fill('Пудровый');await page.getByRole('button',{name:'Добавить цвет',exact:true}).click();await page.getByText('Цвет добавлен и выбран для приёмки.').waitFor();assert.equal(await page.getByRole('combobox',{name:/^Цвет/}).inputValue(),'custom-pink');
 await page.getByRole('button',{name:'Принять рулоны',exact:true}).click();await page.getByText('Рулоны приняты.').waitFor();assert.equal(commands.find(x=>x.action==='RECEIVE').color,'custom-pink');
 await page.getByText('Привязка к товару маркетплейса',{exact:true}).click();await page.getByRole('combobox',{name:/^Товар/}).selectOption('sku');await page.getByRole('button',{name:'Сохранить привязку',exact:true}).click();await page.getByText('Привязка товара сохранена.').waitFor();assert.equal(commands.find(x=>x.action==='BIND_SKU').lengthMm,5000);assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(work,'fabric-workflow.png'),fullPage:true});console.log('Browser PASS: create color, select color, receive roll, bind exact metres; no page errors.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root=process.argv[2],s=fs.readFileSync(process.argv[3]||root+'/web/assets/receipt-manager-20261022.js','utf8'),ast=ts.createSourceFile('x',s,99,true);
// TEST: execute the complete receipt closure with a deliberately different outer alias.
const declaration=ast.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='__ReceiptDirections'));assert.equal(declaration.length,2);
const globalHelper=ast.statements.filter(n=>(ts.isFunctionDeclaration(n)&&n.name?.text==='__ReceiptConfirmation')||(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='__receiptHooks'))).map(n=>n.getText(ast)).join('\n');
esbuild.buildSync({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';const x=React,e={};${declaration.map(n=>n.getText(ast)).join(";\n")};${globalHelper};createRoot(document.getElementById('root')).render(React.createElement(__ReceiptDirections.ReceiptDirectionsPanel,{session:{accessToken:'test',user:{roleCodes:[new URLSearchParams(location.search).get('role')||'ADMIN']}},fixedClientId:'client'}));`,resolveDir:path.resolve(__dirname,'../../../apps/web'),loader:'js'},bundle:true,outfile:root+'/browser.js'});
const server=http.createServer((req,res)=>{if(req.url==='/browser.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(root+'/browser.js'))}res.end(`<html><head><style>${fs.readFileSync(path.resolve(__dirname,'../../../apps/web/src/components/warehouse/receipt-confirmation.css'))}</style></head><body><div style="position:fixed;z-index:2147483647;top:0">Fixed header</div><div id="root" style="transform:translateZ(0);overflow:hidden;margin-top:100px"></div><script src="/browser.js"></script></body></html>`)}).listen(5192,'127.0.0.1');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let saves=0;
 let hold=false,fail=false,release;let capability=true;let lastPreview=null,lastSave=null; await page.route('**/api/v1/**',async route=>{const url=route.request().url(),body=route.request().postDataJSON();
 if(url.includes('/approval')){if(body.save)saves++;else if(hold)await new Promise(resolve=>release=resolve);return route.fulfill({status:fail?409:200,json:fail?{message:'Conflict'}:{}})}
 if(url.includes('/preview')){lastPreview=body;return route.fulfill({json:{available:31,protectedQuantity:0,excludedQuantity:31}});}
 if(route.request().method()==='POST'){lastSave=body;saves++;return route.fulfill({json:{}})}
 return route.fulfill({json:{enabled:true,canManageDirections:capability,rows:[{id:'r',warehouseId:'w',sourceDocument:'FFL_TEST',received:1992,date:'2026-10-20',boxes:[],fbs:true,fbo:true,revision:1,approvalEnabled:true,approval:{available:false,revision:1}}]}});
 });

 // TEST: a pending server check must not delay opening or permit a write.
 await page.goto('http://127.0.0.1:5192/');hold=true;
 await page.getByRole('switch').click();
 await page.locator('dialog').waitFor({state:'visible',timeout:1500});
 assert(await page.locator('dialog button').first().isDisabled());assert.equal(saves,0);
 await page.keyboard.press('Escape');assert(await page.locator('dialog').isVisible());
 while(!release)await new Promise(r=>setTimeout(r,10));release();hold=false;
 await page.locator('dialog button').last().waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.querySelector('dialog button').disabled);
 await page.locator('dialog button').last().click();
 // TEST: rejected preflight cannot leave an actionable confirmation.
 hold=true;fail=true;release=null;await page.getByRole('switch').click();
 await page.locator('dialog').waitFor({state:'visible',timeout:1500});
 while(!release)await new Promise(r=>setTimeout(r,10));release();hold=false;
 await page.locator('dialog').waitFor({state:'detached'});assert.equal(saves,0);fail=false;
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:800});await page.goto('http://127.0.0.1:5192/');
  await page.getByRole('switch').click();const dialog=page.locator('dialog');
  await dialog.waitFor({state:'visible'});assert(await dialog.evaluate(el=>el.matches(':modal')));
  let rect=await dialog.boundingBox();assert(Math.abs(rect.x+rect.width/2-width/2)<2);assert(Math.abs(rect.y+rect.height/2-400)<2);
  await page.screenshot({path:root+'/dialog-'+width+'.png'});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(saves,0);
  await page.getByRole('checkbox',{name:'FBS FFL_TEST',exact:true}).click();await dialog.waitFor({state:'visible'});
  assert(await dialog.evaluate(el=>el.matches(':modal')));
  await dialog.getByRole('button',{name:'Отмена'}).click();assert.equal(saves,0);
 }
 await page.getByRole('switch').click();await page.locator('dialog').getByRole('button',{name:'Подтвердить',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});assert.equal(saves,1);assert.deepEqual(errors,[]);
 // TEST: managers can preview/save with receipt warehouse; read-only capability remains disabled.
 await page.goto('http://127.0.0.1:5192/?role=CLIENT');
 await page.getByRole('checkbox',{name:'FBS FFL_TEST',exact:true}).click();
 await page.locator('dialog').waitFor({state:'visible'});assert.equal(lastPreview.warehouseId,'w');
 await page.locator('dialog button').first().click();await page.locator('dialog').waitFor({state:'detached'});assert.equal(lastSave.warehouseId,'w');assert.equal(lastSave.fbs,false);
 capability=false;await page.reload();await page.getByRole('checkbox',{name:'FBS FFL_TEST',exact:true}).waitFor();assert(await page.getByRole('checkbox',{name:'FBS FFL_TEST',exact:true}).isDisabled());assert(await page.getByRole('checkbox',{name:'FBO FFL_TEST',exact:true}).isDisabled());assert.deepEqual(errors,[]);
 fs.writeFileSync(root+'/browser-proof.json',JSON.stringify({passed:9,widths:[1280,390],nativeTopLayer:true,cancellationNoWrites:true,approvalSavedOnce:true}));console.log('PASS 9 browser scenarios');
}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);server.close();process.exitCode=1});

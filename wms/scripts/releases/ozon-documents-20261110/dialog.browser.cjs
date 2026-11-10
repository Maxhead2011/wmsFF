// TEST: real dialog module with controlled HTTP; no physical print job is created.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]);fs.mkdirSync(root,{recursive:true});
const source=fs.readFileSync(root+'/web-payload/assets/ozon-documents-print-dialog-20261110.js','utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:99,module:99}}).outputText.replace(/export /g,'');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let passed=0;
try{
 for(const mode of ['ready','cancel','offline','retry']){
  const page=await browser.newPage();const posts=[];
  await page.route('https://ribbon.test/**',async route=>{
   const p=new URL(route.request().url()).pathname;
   if(p==='/')return route.fulfill({contentType:'text/html',body:'<html><body><button>Фон</button></body></html>'});
   let body;
   if(p.endsWith('/stations'))body=mode==='offline'?[]:[{id:'a'},{id:'b'}];
   else if(p.endsWith('/formats'))body=[{id:'a',name:'Склад 1',printerName:'TSC 1',labelWidthMm:58,labelHeightMm:40},{id:'b',name:'Склад 2',printerName:'TSC 2',labelWidthMm:58,labelHeightMm:40}];
   else if(p.endsWith('/pdf-jobs')){posts.push(route.request().postDataJSON());if(mode==='retry'&&posts.length===1)return route.abort('failed');body={id:'job',pages:5,status:'queued'};}
   else throw Error(p);
   return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('https://ribbon.test/');await page.addScriptTag({content:js+'\nwindow.openRibbon=openWbRibbonPrint;'});
  await page.evaluate(()=>window.openRibbon('synthetic','client',{fileBase64:'JVBERi0=',pageCount:5,warnings:['Этикетка недоступна']},'Ozon'));
  assert.equal(await page.getByRole('heading',{name:'Печать всех ШК Ozon'}).count(),1);assert.equal(posts.length,0);assert(await page.getByRole('alert').textContent().then(x=>x.includes('Этикетка недоступна')));
  assert.equal(await page.locator('dialog:modal').count(),1);
  if(mode==='offline'){assert(await page.getByRole('button',{name:'Печатать',exact:true}).isDisabled());passed++;}
  else if(mode==='cancel'){await page.getByRole('button',{name:'Отмена'}).click();assert.equal(posts.length,0);assert.equal(await page.locator('dialog').count(),0);passed++;}
  else{
   await page.getByRole('combobox').selectOption('b');await page.screenshot({path:root+'/print-dialog.png'});
   await page.getByRole('button',{name:'Печатать',exact:true}).click();
   if(mode==='retry'){await page.getByRole('button',{name:'Повторить отправку'}).click();assert.equal(posts[0].requestId,posts[1].requestId);}
   await page.getByRole('button',{name:'Закрыть',exact:true}).waitFor();assert.equal(posts.at(-1).stationId,'b');assert.equal(posts.at(-1).fileBase64,'JVBERi0=');passed++;
  }
  await page.close();
 }
 fs.writeFileSync(root+'/print-dialog-proof.json',JSON.stringify({passed,realModule:true,syntheticHttp:true}));console.log({passed});
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

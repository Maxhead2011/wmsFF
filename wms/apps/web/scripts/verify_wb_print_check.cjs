// TEST: exact-order search, error/empty states and stale responses in a real browser.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.argv[2]||'wb-print-browser');
const pnpm=path.resolve(root,'../../node_modules/.pnpm');
const esbuild=require(path.join(pnpm,fs.readdirSync(pnpm).filter(n=>n.startsWith('esbuild@')).sort().at(-1),'node_modules/esbuild'));
const report={orderId:'5786259714',checkedAt:'2026-09-17T15:05:00Z',results:[{id:'a',clientId:'c',clientName:'Лукин',connectionName:'WB',requestNumber:1065,warehouseName:'ФФ Москва',productName:'Костюм',article:'Худи',barcode:'2045200957400',boxCode:'FFL_LKBBOX_0098',kiz:'sample-kiz',wbMetaStatus:'ACCEPTED',workerName:'Марифат',completedAt:'2026-09-17T08:08:58Z',scans:[{action:'FBS_KIZ_SCAN_ACCEPTED',at:'2026-09-17T08:08:56Z',worker:'Марифат',kiz:'sample-kiz',boxCode:'FFL_LKBBOX_0098'}],prints:[{id:'j',status:'PRINTED',kiz:'sample-kiz',deviceCode:'SOS-WB:fixture',requestedBy:'Соня',createdAt:'2026-09-17T15:04:38Z',printedAt:'2026-09-17T15:04:40Z',attempts:1,stickerCode:'WB',station:{name:'17.09',printerName:'TSC TE200'}}],labelRequests:[]}]};
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {WbPrintCheckPanel} from './src/components/service/WbPrintCheckPanel';import './src/styles.css';import './src/components/service/service-center.css';createRoot(document.getElementById('root')).render(<WbPrintCheckPanel accessToken="fixture-only"/>);`,resolveDir:root,loader:'tsx'},bundle:true,external:['/cursors/*'],jsx:'automatic',outfile:path.join(output,'app.js'),define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}});
 const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<html lang="ru"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><main style="max-width:1200px;margin:30px auto;padding:20px" id="root"></main><script src="/app.js"></script></html>');}else if(['/app.js','/app.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(output,req.url.slice(1))));}else{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try {
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1200}});let reads=0,writes=0,held;const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/api/v1/**',async route=>{
   if(route.request().method()!=='GET')writes++;else reads++;
   const order=new URL(route.request().url()).searchParams.get('orderId');
   if(order==='111'){held=route;return;}
   if(order==='500')return route.fulfill({status:500,json:{message:'Ошибка сервера'}});
   return route.fulfill({json:order==='123'?{...report,orderId:order,results:[]}:report});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const input=page.getByLabel('Номер заказа WB'),button=page.getByRole('button',{name:'Проверить',exact:true});
  await input.fill('abc');await button.click();await page.getByRole('alert').waitFor();assert.equal(reads,0);
  await input.fill('5786259714');await button.click();await page.getByText('Печать подтверждена агентом',{exact:true}).waitFor();
  assert.ok((await page.locator('body').innerText()).includes('18:04:40'));await page.screenshot({path:path.join(output,'report.png'),fullPage:true});
  await input.fill('123');await button.click();await page.getByText('По этому заказу нет доступных записей сборки или печати.').waitFor();
  await input.fill('500');await button.click();await page.getByRole('alert').waitFor();
  await input.fill('111');await button.click();await page.waitForTimeout(100);
  await input.fill('123');await button.click();await page.getByText('По этому заказу нет доступных записей сборки или печати.').waitFor();
  assert.ok(held);await held.fulfill({json:report});await page.waitForTimeout(100);
  assert.equal(await page.getByText('Печать подтверждена агентом',{exact:true}).count(),0);
  assert.equal(writes,0);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,search:true,empty:true,error:true,staleResponseIgnored:true,writes},null,2));
  console.log('WB print check browser tests passed');
 } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});

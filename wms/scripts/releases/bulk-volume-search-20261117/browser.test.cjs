// TEST: load the actual candidate module graph and intercept every business API call.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const root=path.resolve(process.argv[2]), live=process.argv.includes('--live');
const execFile=require('node:util').promisify(require('node:child_process').execFile);
const asset='/assets/bulk-volume-search-20261117.js';
const cache=new Map();
async function publicFile(p){if(!cache.has(p))cache.set(p,execFile('curl.exe',['--fail','--silent','--show-error','--retry','2','--max-time','30','https://wms.logoff.pro'+p],{encoding:'buffer',maxBuffer:20000000}).then(r=>r.stdout));return cache.get(p);}
(async()=>{
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 for(const width of [1200,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],writes=[],reads=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});
  page.on('console',m=>{if(m.type()==='error')console.error('Browser console:',m.text());});
  const items=['one','two'].map((id,i)=>({id,name:'Товар '+id,article:'Арт-01',internalSku:id,clientSku:null,barcodes:[{id:'b'+id,value:i?'111':'00123',isPrimary:true}],volumeLiters:null,volumeSource:'CALCULATED',lengthCm:null,widthCm:null,heightCm:null}));
  let delayed;
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.startsWith('/api/')){
    if(url.pathname.endsWith('/skus/bulk-volume')){
     if(req.method()==='PATCH'){writes.push(req.postDataJSON());return route.fulfill({json:{clientId:'client-1',newVolumeLiters:2.5,updated:1}});}
     reads.push(Object.fromEntries(url.searchParams));
     if(url.searchParams.get('search')==='delayed'){delayed=route;return;}
     if(url.searchParams.get('search')==='failed')return route.fulfill({status:500,json:{message:'Ошибка проверки'}});
     return route.fulfill({json:{client:{id:'client-1'},volumes:[],items:url.searchParams.get('search')?items:[],total:url.searchParams.get('search')?2:0}});
    }
    return route.fulfill({json:[]});
   }
   if(req.method()!=='GET')return route.abort();
   let body;
   if(url.pathname==='/')body=live?await publicFile('/'):fs.readFileSync(path.join(root,'web-candidate/index.html'));
   else if(url.pathname===asset){body=live?await publicFile(asset):fs.readFileSync(path.join(root,'web-candidate',path.basename(asset)));body=Buffer.concat([body,Buffer.from(';window.__volumeProof={React:x,createRoot:iT.createRoot,Editor:wD};')]);}
   else if(url.pathname==='/assets/bulk-volume-search-20261117.css')body=live?await publicFile(url.pathname):fs.readFileSync(path.join(root,'web-candidate',path.basename(url.pathname)));
   else if(url.hostname==='fixture.test')body=await publicFile(url.pathname);
   else return route.abort();
   return route.fulfill({body,contentType:url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.woff2')?'font/woff2':url.pathname==='/'?'text/html':'application/octet-stream'});
  });
  await page.goto('http://fixture.test/',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__volumeProof,{},{timeout:60000});
  await page.evaluate(()=>{
   const {React,createRoot,Editor}=window.__volumeProof;
   document.getElementById('root').style.display='none';const host=document.createElement('main');host.id='volume-test';document.body.append(host);
   createRoot(host).render(React.createElement(Editor,{clients:[{id:'client-1',code:'C1',name:'Тестовый клиент'},{id:'client-2',code:'C2',name:'Другой клиент'}],defaultClientId:'',session:{accessToken:'fixture',user:{id:'fixture'}},onApplied(){}}));
  });
  const editor=page.locator('#volume-test');await editor.locator('select').selectOption('client-1');
  await editor.getByLabel('Артикул / баркод',{exact:true}).fill('00123');await editor.getByLabel('Выбрать Товар one',{exact:true}).waitFor();
  assert.deepEqual(reads.at(-1),{clientId:'client-1',search:'00123'});
  assert.equal(await editor.getByLabel('Литраж от, л',{exact:true}).getAttribute('required'),null);
  await editor.getByLabel('Выбрать Товар two',{exact:true}).uncheck();await editor.getByLabel('Новый литраж, л',{exact:true}).fill('2.5');
  await editor.getByLabel('Артикул / баркод',{exact:true}).press('Enter');assert.equal(writes.length,0);
  page.once('dialog',d=>d.accept());await editor.getByRole('button',{name:'Изменить у 1',exact:true}).click();await editor.getByText(/Готово: литраж изменён у 1/).waitFor();
  assert.deepEqual(writes,[{clientId:'client-1',search:'00123',skuIds:['one'],newVolumeLiters:2.5}]);
  assert.equal(await editor.getByLabel('Литраж от, л',{exact:true}).inputValue(),'');
  await editor.getByLabel('Артикул / баркод',{exact:true}).fill('delayed');await page.waitForFunction(()=>!document.querySelector('#volume-test tbody'));
  assert.equal(await editor.getByRole('button',{name:'Изменить у 0',exact:true}).isDisabled(),true);
  await editor.getByLabel('Артикул / баркод',{exact:true}).fill('Арт-01');await editor.getByLabel('Выбрать Товар one',{exact:true}).waitFor();
  if(delayed)await delayed.fulfill({json:{client:{id:'client-1'},volumes:[],items:[],total:0}});await page.waitForTimeout(100);
  assert.equal(await editor.getByLabel('Выбрать Товар one',{exact:true}).count(),1);
  await editor.getByLabel('Литраж от, л',{exact:true}).fill('1');assert.equal(await editor.getByRole('button',{name:'Изменить у 0',exact:true}).isDisabled(),true);
  await editor.getByLabel('Литраж до, л',{exact:true}).fill('3');await editor.getByLabel('Выбрать Товар one',{exact:true}).waitFor();assert.deepEqual(reads.at(-1),{clientId:'client-1',sourceVolumeFrom:'1',sourceVolumeTo:'3',search:'Арт-01'});
  await editor.locator('select').selectOption('client-2');assert.equal(await editor.getByLabel('Артикул / баркод',{exact:true}).inputValue(),'');
  await editor.getByLabel('Артикул / баркод',{exact:true}).fill('failed');await editor.getByText('Ошибка проверки',{exact:true}).waitFor();
  assert.equal(await editor.getByRole('button',{name:'Изменить у 0',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(root,`browser-${live?'published':'candidate'}-${width}.png`),fullPage:true});await page.close();
 }
 console.log(JSON.stringify({browser:'Edge',widths:[1200,390],actualModuleGraph:true,apiWritesIntercepted:true,published:live,passed:true}));
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

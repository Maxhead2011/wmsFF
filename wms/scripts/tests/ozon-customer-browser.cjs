// TEST: execute the published-graph candidate and verify Ozon isolation and allocation input.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=process.argv[2],base=process.argv[3],entry=/src="\/assets\/([^"/]+\.js)"/.exec(fs.readFileSync(path.join(root,'index.html'),'utf8'))[1];
const panel=fs.readdirSync(path.join(root,'assets')).find(n=>fs.readFileSync(path.join(root,'assets',n),'utf8').includes('function LegacyWbBi('));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage(),errors=[];let sent;
 page.on('pageerror',e=>errors.push(e.message));
 const plan={marketplace:'OZON',requestId:'r',number:7,title:'Кубрин',phase:'PACKING',needed:4,picked:4,packed:0,route:[],boxes:[],wholeBoxes:[],lines:[],directions:[{name:'Москва',needed:2,packed:0,items:[]},{name:'Казань',needed:2,packed:0,items:[]}]};
 await page.route('http://localhost/**',async route=>{
  const n=new URL(route.request().url()).pathname.slice(1);
  if(n==='fixture')return route.fulfill({contentType:'text/html',body:'<div id="root" style="display:none"></div><div id="fixture-root"></div>'});
  if(n.startsWith('api/')){if(n.endsWith('/actions'))sent=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify(n.includes('capability')?{enabled:true}:plan)});}
  const file=[path.join(root,n),path.join(base,n)].find(f=>fs.existsSync(f));if(!file)return route.abort();let body=fs.readFileSync(file);
  if(n==='assets/'+entry)body=body.toString()+'\nexport {x as TestReact,ws as TestDom};';
  if(n==='assets/'+panel)body=body.toString()+'\nexport {__Ozon as TestOzon,Bi as TestPanel};';
  return route.fulfill({contentType:n.endsWith('.js')?'application/javascript':n.endsWith('.css')?'text/css':'text/html',body});
 });
 await page.goto('http://localhost/fixture');
 await page.evaluate(async({entry,panel,plan})=>{const m=await import('/assets/'+entry),p=await import('/assets/'+panel);window.fixture={m,p,root:m.TestDom.createRoot(document.getElementById('fixture-root'))};window.fixture.root.render(m.TestReact.createElement(p.TestPanel,{initial:plan,accessToken:'fixture',userId:'u',canWrite:true,onClose:()=>{}}));},{entry,panel,plan});
 await page.getByText('Единая сборка · направления',{exact:true}).waitFor();
 await page.getByLabel('Направление короба').selectOption('Казань');
 await page.getByText('Сканирование в ВМС',{exact:true}).click();
 await page.locator('form input').fill('NEW_BOX');await page.getByText('Подтвердить скан',{exact:true}).click();
 await page.waitForTimeout(300);assert.equal(sent.direction,'Казань');assert.equal(sent.action,'OPEN_BOX');
 assert.equal(await page.getByText('Скачать WB',{exact:false}).count(),0);
 await page.evaluate(()=>{const{m,p,root}=window.fixture;root.render(m.TestReact.createElement(p.TestOzon.OzonCustomerImport,{session:{accessToken:'fixture'},clients:[{id:'c',name:'Кубрин'}],onCreated:()=>{}}));});
 await page.getByText('ФБО Ozon — файл клиента по направлениям',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS candidate graph: one React, destination payload, Ozon importer and no WB download');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

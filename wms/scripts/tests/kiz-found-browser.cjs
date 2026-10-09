// TEST: real patched JS graph, no-box scan -> review -> authorization -> explicit return.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=process.argv[2],base=process.argv[3],entry=/src="\/assets\/([^"/]+\.js)"/.exec(fs.readFileSync(path.join(root,'index.html'),'utf8'))[1];
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage(),errors=[],actions=[];let row=null;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://localhost/**',async route=>{const n=new URL(route.request().url()).pathname.slice(1);
  if(n==='fixture')return route.fulfill({contentType:'text/html',body:'<div id="root" style="display:none"></div><div id="fixture-root"></div>'});
  if(n.startsWith('api/')){let data=[];
   if(n.endsWith('kiz-location/reviews'))data={items:[],nextCursor:null};
   if(n.endsWith('kiz-location/check'))data={found:true,ambiguous:false,identity:'test',foundCandidate:{markId:'m',identity:'test'},reviews:[],matches:[{id:'m',status:'SHIPPING',client:'Клиент',product:{name:'Костюм'},boxCode:null}]};
   if(n.endsWith('kiz-found')){if(route.request().method()==='POST'){
    const p=route.request().postDataJSON();actions.push(p);assert.equal(p.confirmed,true);assert.ok(p.reason.length>=5);
    if(p.action==='OPEN')row={id:'r',kizIdentity:'test',status:'OPEN',decision:'REVIEW',createdAt:new Date().toISOString(),snapshot:{markId:'m',productName:'Костюм',workerName:'Админ',returned:false},evidence:{history:[]}};
    if(p.action==='REUSE'){row.resolution='REUSE';row.status='APPROVED';assert.equal(row.snapshot.returned,false);}
    if(p.action==='RETURN'){assert.equal(p.boxCode,'BOX222');row.snapshot.returned=true;row.snapshot.boxCode='BOX222';}
    data=row;
   }else data=row?[row]:[];}
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  const file=[path.join(root,n),path.join(base,n)].find(p=>fs.existsSync(p));if(!file)return route.abort();let body=fs.readFileSync(file);
  if(n==='assets/'+entry)body=body.toString()+'\nexport {x as TestReact,ws as TestDom,m4 as TestKiz};';
  return route.fulfill({contentType:n.endsWith('.js')?'application/javascript':n.endsWith('.css')?'text/css':'text/html',body});
 });
 await page.goto('http://localhost/fixture');await page.evaluate(async entry=>{const m=await import('/assets/'+entry);m.TestDom.createRoot(document.getElementById('fixture-root')).render(m.TestReact.createElement(m.TestKiz,{session:{accessToken:'fixture',user:{id:'u',roleCodes:['OWNER'],permissionCodes:['system:admin']}}}));},entry);
 await page.getByLabel('КИЗ',{exact:true}).fill('test');await page.getByRole('button',{name:'Проверить',exact:true}).click();
 await page.getByRole('button',{name:'Товар физически у меня — отправить на разбор'}).click();
 async function confirm(reason){await page.getByLabel('Основание',{exact:true}).fill(reason);await page.getByLabel('Подтверждаю физическое наличие товара и выбранное действие',{exact:false}).check();await page.getByRole('button',{name:'Подтвердить',exact:true}).click();}
 await confirm('Физически найден');await page.locator('summary').filter({hasText:'Костюм'}).click();
 await page.getByRole('button',{name:'Разрешить использовать КИЗ',exact:true}).click();await confirm('КИЗ проверен');
 await page.getByText('Возврат ещё не учтён · разрешение сохранено для одного следующего отбора',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Вернуть на склад',exact:true}).click();await page.getByLabel('Отсканируйте короб').fill('BOX222');await confirm('Возврат подтверждён');
 await page.getByText('Возврат учтён · разрешение сохранено для одного следующего отбора',{exact:true}).waitFor();
 assert.deepEqual(actions.map(p=>p.action),['OPEN','REUSE','RETURN']);assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(root,'kiz-found-preview.png'),fullPage:true});console.log('PASS: actual KIZ screen, explicit confirmation, authorization without stock, separate return, single React');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

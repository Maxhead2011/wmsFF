// TEST: exercise the real payroll component (or the exact publication bundle), including outgoing edit/undo requests.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=path.resolve(__dirname,'../../..');
function component(){
 if(process.env.PAYROLL_RUNTIME_BUNDLE){const s=fs.readFileSync(process.env.PAYROLL_RUNTIME_BUNDLE,'utf8'),start=s.indexOf('const WmsPayrollManagement=(()=>{'),end=s.indexOf(';return PayrollManagement;})();',start);assert(start>=0&&end>start);return s.slice(start,end+';return PayrollManagement;})();'.length);}
 const ts=require(path.resolve(web,'../../node_modules/typescript'));
 const compile=name=>ts.transpileModule(fs.readFileSync(path.join(__dirname,name),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React,jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}}).outputText;
 return 'const WmsPayrollManagement=(()=>{const {useState,useEffect}=React;const fetchBranches=qo;const payrollRequest=(accessToken,path,method="GET",body)=>z("/expenses/workforce"+path,{method,body});'+compile('PayrollHistory.tsx')+compile('PayrollManagement.tsx')+';return PayrollManagement;})();';
}
test('filter, employee correction, handling correction and history undo work through the actual forms',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<html><body><div id="root"></div></body></html>');
  await page.addScriptTag({path:path.resolve(web,'node_modules/react/umd/react.development.js')});
  await page.addScriptTag({path:path.resolve(web,'node_modules/react-dom/umd/react-dom.development.js')});
  await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'payroll.css'),'utf8')});
  await page.addScriptTag({content:`
   const x=React;window.calls=[];window.undone=false;
   const people=['wrong','right','idle'].map((id,i)=>({id,name:['Ошибочный сотрудник','Правильный сотрудник','Не работал'][i],warehouseId:'w',isActive:true,picker:true,loader:true,paymentMethod:'CASH',rates:[]}));
   const qo=async()=>[{id:'branch',name:'Москва',warehouses:[{id:'w',name:'ФФ Москва'}]}];
   const shift={id:'shift',start:'2026-10-06T06:00:00.123Z',end:'2026-10-06T15:00:00.456Z',version:3};
   const handling={id:'handling',warehouseId:'w',startsAt:'2026-10-06T06:00:00.123Z',operation:'UNLOAD',palletCount:1,boxCount:16,bagCount:5,rollCount:30,status:'CONFIRMED',shares:[{employeeId:'wrong'}],correctionToken:'version-token'};
   const z=async(url,options={})=>{const p=url.replace('/expenses/workforce','');window.calls.push({path:p,...options});
    if(p==='/capabilities')return {enabled:true,correctionsEnabled:true};if(p==='/employees')return people;if(p==='/picking-users')return [];
    if(p.includes('/undo')){window.undone=true;return {undone:'audit'};}
    if(p.startsWith('/history?'))return {entries:[{id:'audit',createdAt:'2026-10-06T12:00:00Z',actorName:'Администратор',action:'SHIFT_CORRECTED',canUndo:!window.undone,undone:window.undone,details:{reason:'Не та учётка',names:{wrong:people[0].name,right:people[1].name},before:{kind:'SHIFT',shift:{employeeId:'wrong',startsAt:shift.start,endsAt:shift.end,workDate:'2026-10-06'}},after:{kind:'SHIFT',shift:{employeeId:'right',startsAt:shift.start,endsAt:shift.end,workDate:'2026-10-06'}}}}],nextCursor:null};
    if(options.method==='PUT')return {};
    if(p.includes('/report?'))return {rows:p.includes('/wrong/')?[{key:'WORK:wrong:2026-10-06',employeeId:'wrong',date:'2026-10-06',kind:'HOURLY',amountKopecks:240000,status:'UNPAID',workedMs:32400000,lunchMs:3600000,detail:{shifts:[shift],segments:[{start:shift.start,end:shift.end,rateKopecks:30000}]}},{key:'HANDLING:handling:wrong',employeeId:'wrong',date:'2026-10-06',kind:'PALLET',amountKopecks:200000,status:'UNPAID',detail:handling}]:[],issues:[],totals:{amountKopecks:240000,paidKopecks:0}};
    if(p.endsWith('/shifts'))return [];
    throw Error('Unexpected API '+p);
   };
   ${component()}
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(WmsPayrollManagement,{session:{accessToken:'test',user:{activeWarehouseId:'w'}},legacy:null}));
  `});
  await page.getByRole('table',{name:'Записи табеля'}).waitFor();
  assert.equal(await page.locator('.payroll-payment-summary tbody tr').count(),1);
  assert(!await page.locator('.payroll-payment-summary').innerText().then(s=>s.includes('Не работал')));
  await page.getByRole('button',{name:'Редактировать',exact:true}).click();
  await page.getByLabel('Сотрудник этой смены',{exact:true}).selectOption('right');
  await page.getByRole('dialog').locator('[name="reason"]').fill('Ошибочно выбрана учётка');
  await page.getByRole('dialog').getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const shiftCall=await page.evaluate(()=>calls.find(c=>c.method==='PUT'&&c.path.includes('/shifts/')));
  assert.equal(shiftCall.body.employeeId,'right');assert.equal(shiftCall.body.expectedVersion,3);assert.equal(shiftCall.body.startsAt,'2026-10-06T06:00:00.123Z');
  await page.getByRole('button',{name:'Погрузка и разгрузка',exact:true}).click();
  await page.getByRole('button',{name:'Редактировать',exact:true}).click();
  const edit=page.locator('form').filter({has:page.locator('[name="member"]')});
  await edit.locator('[name="member"][value="wrong"]').uncheck();await edit.locator('[name="member"][value="right"]').check();
  await edit.locator('[name="boxes"]').fill('32');await edit.locator('[name="reason"]').fill('Правильный участник и объём');
  await edit.getByRole('button',{name:'Сохранить изменения'}).click();
  await edit.waitFor({state:'hidden'});
  const handlingCall=await page.evaluate(()=>calls.find(c=>c.method==='PUT'&&c.path==='/handling/handling'));
  assert.deepEqual(handlingCall.body.employeeIds,['right']);assert.equal(handlingCall.body.boxCount,32);assert.equal(handlingCall.body.expectedState,'version-token');assert.equal(handlingCall.body.startsAt,'2026-10-06T06:00:00.123Z');
  await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.locator('summary').filter({hasText:'История изменений'}).click();
  await page.getByRole('radio').check();
  const chosen=page.getByRole('region',{name:'Выбранное изменение'});await chosen.waitFor();
  assert((await chosen.innerText()).includes('Правильный сотрудник'));assert((await chosen.innerText()).includes('Ошибочный сотрудник'));
  await page.getByLabel('Причина отмены изменения').fill('Нужно восстановить');await page.getByRole('button',{name:'Отменить изменение',exact:true}).click();
  await page.getByText('Изменение отменено. Результат сохранён в истории.').waitFor();
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.path==='/history/audit/undo').length),1);assert.deepEqual(errors,[]);
  if(process.env.PAYROLL_SCREENSHOT)await page.screenshot({path:process.env.PAYROLL_SCREENSHOT,fullPage:true});
 }finally{await browser.close();}
});

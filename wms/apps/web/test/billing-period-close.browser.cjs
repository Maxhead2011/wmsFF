// TEST: exercise real React controls with synthetic finances; all API traffic is intercepted.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.WMS_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.argv[2]);
const overlay = process.argv[3] ? path.resolve(process.argv[3]) : root;
const user = { id: 'fixture', name: 'Константин', email: 'fixture@example.invalid', roleCodes: ['OWNER'], permissionCodes: ['system:admin','billing:read','billing:write'], clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:'w',warehouseIds:['w'],writableWarehouseIds:['w'] };
const client = { id: 'c', code: 'CL-TEST', name: 'Тестовый клиент' };
const invoice = { id:'i',number:'INV-TEST',clientId:'c',client,status:'ISSUED',serviceCategory:'STORAGE',periodFrom:'2026-09-01',periodTo:'2026-09-30',totalRub:100,paidRub:45,issuedAt:'2026-09-30',items:[],payments:[],comment:'' };
const server = http.createServer((req,res) => {
  const name = new URL(req.url,'http://local').pathname;
  const changed = path.resolve(overlay, '.'+(name === '/' ? '/index.html' : name.replace(/^\/assets\//,'/')));
  const file = changed.startsWith(overlay+path.sep) && fs.existsSync(changed) ? changed : path.resolve(root, '.'+(name === '/' ? '/index.html' : name));
  if ((!file.startsWith(root+path.sep) && !file.startsWith(overlay+path.sep)) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(ok => server.listen(0,'127.0.0.1',ok));
  const browser = await chromium.launch({headless:true,channel:process.env.WMS_BROWSER_CHANNEL || 'msedge'});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}}), errors=[], writes=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(user => localStorage.setItem('logoff-wms-session',JSON.stringify({accessToken:'fixture-only',tokenType:'Bearer',user})),user);
    await page.route('**/api/v1/**',async route => {
      const req=route.request(),url=new URL(req.url()),p=url.pathname;let data=[];
      if(req.method()!=='GET')writes.push({path:p,input:req.postDataJSON()});
      if(p.endsWith('/auth/me'))data=user;
      else if(p.endsWith('/branches'))data=[{id:'w',code:'MSK',name:'Москва',warehouseId:'w',isActive:true}];
      else if(p.endsWith('/clients'))data=[client];
      else if(p.endsWith('/capabilities'))data={enabled:true};
      else if(p.endsWith('/billing/settlements'))data={enabled:true,warehouseName:'Москва',calculatedAt:'2026-10-03',rows:[],issues:[]};
      else if(p.endsWith('/billing/invoices'))data=[invoice];
      else if(p.endsWith('/corrections/preview')) {
        const input=req.postDataJSON();assert.equal(input.amountRub,'-25.50');
        data={...input,invoiceNumber:'INV-TEST',amountRub:-25.5,previewHash:'a'.repeat(64),before:{},after:{effectiveTotalRub:74.5,remainingRub:29.5,overpaymentRub:0}};
      }
      else if(p.endsWith('/corrections')&&req.method()==='POST') {
        const input=req.postDataJSON();assert.equal(input.amountRub,'-25.5');assert.match(input.operationKey,/^[a-f0-9-]{36}$/);data={correction:{id:'note'}};
      }
      else if(p.endsWith('/period-close/preview'))data={canClose:false,previewHash:'b'.repeat(64),snapshots:[],issues:[{sourceId:'work',code:'WORK_WITHOUT_CHARGE',reason:'Нет начисления'}]};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByRole('button',{name:'Биллинг',exact:true}).click();
    await page.getByRole('tab',{name:'Клиенты и расчёты',exact:true}).click();
    const section=page.getByRole('region',{name:'Клиенты и расчёты',exact:true});
    await section.locator('.billing-settlements__filters select').selectOption('c');
    await page.getByLabel('Счёт для исправления').selectOption('i');
    await page.getByLabel('Изменение суммы').fill('-25.50');await page.getByLabel('Причина исправления').fill('Ошибка тарифа');
    await page.getByRole('button',{name:'Рассчитать исправление',exact:true}).click();
    await page.getByLabel('Предварительная корректировка').waitFor();
    assert.match(await page.getByLabel('Предварительная корректировка').innerText(),/29,50/);
    await page.getByLabel('Изменение суммы').fill('-20');assert.equal(await page.getByLabel('Предварительная корректировка').count(),0);
    await page.getByLabel('Изменение суммы').fill('-25.50');await page.getByRole('button',{name:'Рассчитать исправление',exact:true}).click();
    await page.getByRole('button',{name:'Сохранить отдельный документ',exact:true}).click();
    await page.getByLabel('Счёт для исправления').waitFor();
    await page.getByLabel('Основание закрытия').fill('Проверено');await page.getByRole('button',{name:'Проверить перед закрытием',exact:true}).click();
    await page.getByText('Нет начисления',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Закрыть проверенный период'}).isDisabled(),true);
    assert.equal(writes.filter(w=>w.path.endsWith('/corrections')).length,1);
    assert.equal(writes.some(w=>w.path.endsWith('/period-close')),false);assert.deepEqual(errors,[]);
    console.log('PASS: signed correction, exact money, preview invalidation, blocked closure; fixture data only');
  } finally { await browser.close();server.close(); }
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

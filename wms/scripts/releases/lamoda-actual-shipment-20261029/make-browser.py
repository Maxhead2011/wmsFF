from pathlib import Path
p=Path(__file__).parent
s=(p.parent/'lamoda-source-scan-20261028/browser.cjs').read_text(encoding='utf8')
s=s.replace("let passed=0,prints=0,confirmations=0;", "let passed=0,prints=0,confirmations=0,sends=0,payload=null;")
anchor="  else if(req.method()!=='GET')"
routes="""  else if(p.endsWith('/submission'))data={receipt:null,remoteShipmentId:null,items:[{skuId:'sku',name:'Coat',size:'52',quantity:1}]};
  else if(p.endsWith('/submission/preview')){const b=req.postDataJSON();assert.equal(b.prices[0].priceMinor,10050);payload={...b,items:[{externalSku:'SELLER52',ean:'4640684266611',quantity:1,price:{amount:10050}}]};data={payload};}
  else if(p.endsWith('/submission/send')){sends++;assert.equal(req.postDataJSON().externalShipmentId,'UPD-1');data={state:'SUCCEEDED',remoteId:'MPG1',payload,updatedAt:new Date().toISOString()};}
  else if(p.endsWith('/submission/refresh'))data={state:'SUCCEEDED',remoteId:'MPG1',remoteStatus:'VALIDATION',payload,updatedAt:new Date().toISOString()};
"""
s=s.replace(anchor,routes+anchor)
a=s.index(" const pane=page.getByRole('region'");b=s.index(" }catch(e)",a)
s=s[:a]+""" const pane=page.getByRole('region',{name:'Оформление поставки Lamoda'});await pane.waitFor();
 await pane.getByLabel('Номер поставки / УПД',{exact:true}).fill('UPD-1');await pane.getByLabel('Дата поставки',{exact:true}).fill('2026-11-01');await pane.getByLabel('Цена Coat',{exact:true}).fill('100,50');
 assert.equal(await pane.getByRole('button',{name:'Создать поставку в Lamoda',exact:true}).count(),0);passed++;
 await pane.getByRole('button',{name:'Проверить фактический состав',exact:true}).click();await pane.getByText('SELLER52',{exact:true}).waitFor();passed++;
 const send=pane.getByRole('button',{name:'Создать поставку в Lamoda',exact:true});assert(await send.isDisabled());passed++;
 await pane.getByRole('checkbox').check();assert(await send.isEnabled());await send.click();await pane.getByText(/Поставка создана/).waitFor();assert.equal(sends,1);passed++;
 assert.equal(await pane.getByRole('button',{name:'Создать поставку в Lamoda',exact:true}).count(),0);passed++;
 await pane.getByRole('button',{name:'Обновить статус Lamoda',exact:true}).click();await pane.getByText(/Проверка Lamoda/).waitFor();passed++;
 assert.deepEqual(errors,[]);await page.screenshot({path:out+'/submission.png'});
 fs.writeFileSync(root+(process.env.WEB_ORIGIN?'/public-browser-proof.json':'/browser-proof.json'),JSON.stringify({passed,isolatedApi:true}));console.log(JSON.stringify({passed,isolatedApi:true}));
"""+s[b:]
(p/'browser.cjs').write_text(s,encoding='utf8')

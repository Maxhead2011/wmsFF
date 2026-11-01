// TEST: the real header and binding form work during picking and preserve the assembly window.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const esbuild=require(process.env.ESBUILD_MODULE||'esbuild');
test('binds an existing WB supply from the header while picking',async()=>{
  const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
    import {FboTwoStagePanel} from './FboTwoStagePanel';import {PantheraWorkspaces} from '../layout/PantheraWorkspaces';
    window.plan={requestId:'fixture',number:2567,title:'Транзит Никольское - Беларусь (великий камень)',marketplace:'WILDBERRIES',phase:'PICKING',needed:50,picked:3,packed:0,looseRemaining:47,shortage:0,compositionChanged:false,wholeBoxes:[],lines:[],route:[],boxes:[]};
    createRoot(document.getElementById('root')).render(<PantheraWorkspaces activeId="fbo" onOpen={()=>{}} render={()=><FboTwoStagePanel initial={window.plan} accessToken="fixture" userId="fixture" canWrite onClose={()=>{}}/>}/>);`;
  const bundle=await esbuild.build({stdin:{contents:entry,loader:'tsx',resolveDir:__dirname},bundle:true,write:false,jsx:'automatic',
    loader:{'.css':'empty'},define:{'import.meta.env':JSON.stringify({VITE_MARKETPLACE_WORKSPACES_ENABLED:'true'})}});
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const page=await browser.newPage();let binds=0;
    const view={plannedQuantity:50,canWrite:true,canGate:false,connections:[{id:'c',accountName:'Кабинет клиента'}],binding:null};
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
      if(url.pathname.endsWith('/bind')){
        assert.equal(req.method(),'POST');assert.deepEqual(req.postDataJSON(),{connectionId:'c',input:'41834673'});
        binds++;view.binding={supplyId:'41834673',status:'Запланировано',statusId:2,quantity:50,acceptedQuantity:0,checkedAt:new Date().toISOString()};
      }
      if(url.pathname.includes('wb-fbo-supply'))return route.fulfill({json:view});
      if(req.method()!=='GET')throw Error('Unexpected mutation: '+url.pathname);
      return route.fulfill({json:await page.evaluate(()=>window.plan)});
    });
    await page.goto('http://fixture.test');await page.addScriptTag({content:bundle.outputFiles[0].text});
    const header=page.locator('.online-execution-modal__header');
    const button=header.getByRole('button',{name:'Заявка ВБ',exact:true});
    await header.getByRole('button',{name:'Свернуть окно'}).waitFor();
    assert.deepEqual(await header.locator('button:visible').allTextContents(),['Заявка ВБ','−','×']);
    await page.addStyleTag({path:path.join(__dirname,'client-requests.css')});
    await page.addStyleTag({path:path.join(__dirname,'../layout/panthera-windows.css')});
    await page.evaluate(()=>document.documentElement.dataset.uiVariant='la_panthera');
    await page.addStyleTag({path:path.join(__dirname,'wb-supply-window.css')});
    // TEST: both parent controls and the nested close button match the approved 40px size.
    for(const name of ['Свернуть окно','Закрыть']){
      const rect=await header.getByRole('button',{name,exact:true}).boundingBox();assert.deepEqual([rect.width,rect.height],[40,40]);
    }
    // TEST: a long supply title cannot split the window controls.
    for(const width of [980,640,390]){
      await page.setViewportSize({width,height:800});
      const minus=await header.getByRole('button',{name:'Свернуть окно'}).boundingBox();
      const close=await header.getByRole('button',{name:'Закрыть',exact:true}).boundingBox();
      const supply=await button.boundingBox();
      assert.equal(Math.round(minus.y),Math.round(close.y));
      assert(Math.abs(supply.y+supply.height/2-close.y-close.height/2)<1);
      assert(close.x+close.width<=width);
    }
    await button.click();const popup=page.locator('dialog[open]');
    await popup.getByRole('heading',{name:'Передача и приёмка'}).waitFor();
    const closeRect=await popup.getByRole('button',{name:'Закрыть окно'}).boundingBox();
    assert.deepEqual([closeRect.width,closeRect.height],[40,40]);
    await popup.getByLabel('Ссылка или номер поставки WB').fill('41834673');
    await popup.getByRole('button',{name:'Привязать поставку WB'}).click();
    await popup.getByText('Не подтверждена',{exact:false}).waitFor();assert.equal(binds,1);
    await popup.getByRole('button',{name:'Закрыть окно'}).click();
    assert.equal(await page.locator('dialog[open]').count(),0);assert(await button.isVisible());
    await header.getByRole('button',{name:'Свернуть окно'}).click();
    await page.getByTitle(/^Развернуть:/).press('Enter');
    assert(await button.isVisible());assert.equal(binds,1);
  }finally{await browser.close();}
});

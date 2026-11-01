// TEST: the real header and binding form work during picking and preserve the assembly window.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const esbuild=require(process.env.ESBUILD_MODULE||'esbuild');
test('binds an existing WB supply from the header while picking',async()=>{
  const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
    import {FboTwoStagePanel} from './FboTwoStagePanel';import {PantheraWorkspaces} from '../layout/PantheraWorkspaces';
    window.plan={requestId:'fixture',number:2564,title:'Сборка из Excel 30.10.2026',marketplace:'WILDBERRIES',phase:'PICKING',needed:50,picked:3,packed:0,looseRemaining:47,shortage:0,compositionChanged:false,wholeBoxes:[],lines:[],route:[],boxes:[]};
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
    const button=header.getByRole('button',{name:'Поставка ВБ',exact:true});
    await header.getByRole('button',{name:'Свернуть окно'}).waitFor();
    assert.deepEqual(await header.locator('button:visible').allTextContents(),['Поставка ВБ','−','×']);
    await button.click();const popup=page.locator('dialog[open]');
    await popup.getByLabel('Ссылка или номер поставки WB').fill('41834673');
    await popup.getByRole('button',{name:'Привязать поставку WB'}).click();
    await popup.getByText('Не подтверждена',{exact:false}).waitFor();assert.equal(binds,1);
    await popup.getByRole('button',{name:'Закрыть окно'}).click();
    assert.equal(await page.locator('dialog[open]').count(),0);assert(await button.isVisible());
  }finally{await browser.close();}
});

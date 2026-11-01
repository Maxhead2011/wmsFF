const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const esbuild=require(process.env.ESBUILD_MODULE||'esbuild');

// TEST: keyboard access, action grouping and disabled state after real UI acknowledgement.
test('problem menu actions remain usable on narrow screens',async()=>{
  const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
    import '../styles.css';import {WarehouseProblemBell} from './WarehouseProblemBell';
    createRoot(document.getElementById('root')).render(<WarehouseProblemBell scope="test" token="fixture" onOpen={()=>{}}/>);`;
  const build=await esbuild.build({stdin:{contents:entry,loader:'tsx',resolveDir:__dirname},outfile:'test.js',bundle:true,write:false,jsx:'automatic',external:['/cursors/*','*.woff2','*.woff','*.svg','*.png'],define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:360,height:600}});
    let marked=false;
    await page.route('**/*',async r=>{
      const u=new URL(r.request().url());
      if(u.pathname==='/')return r.fulfill({contentType:'text/html',body:'<main id="root" style="display:flex;justify-content:flex-end"></main>'});
      if(u.pathname.endsWith('/read-all')){assert.deepEqual(r.request().postDataJSON(),{ids:['a']});marked=true;return r.fulfill({json:{readIds:['a']}});}
      return r.fulfill({json:u.searchParams.has('archive')||marked?[]:[{id:'a',kind:'product',title:'Проверка',createdAt:'2026-11-01T12:00:00Z',isRead:false}]});
    });
    await page.goto('http://fixture.test');
    await page.addStyleTag({content:build.outputFiles.find(f=>f.path.endsWith('.css')).text});
    await page.addScriptTag({content:build.outputFiles.find(f=>f.path.endsWith('.js')).text});
    await page.getByRole('button',{name:'Проблемы с товаром: 1'}).click();
    const menu=page.getByRole('dialog'),archive=menu.getByRole('button',{name:'Архив проблем'}),all=menu.getByRole('button',{name:'Прочитать все'});
    assert(await archive.evaluate(e=>e.parentElement.classList.contains('warehouse-problem-controls')));
    await archive.focus();await page.keyboard.press('Enter');await menu.getByText('Архив пуст').waitFor();
    await menu.getByRole('button',{name:'Свернуть архив'}).click();
    await all.click();await menu.getByText('Непрочитанных проблем нет').waitFor();assert(marked&&await all.isDisabled());
    for(const button of [archive,all]){const b=await button.boundingBox();assert(b&&b.x>=0&&b.x+b.width<=360&&b.height>=38);}
    if(process.env.PROBLEM_BUTTON_PREVIEW){await page.setViewportSize({width:720,height:600});await menu.locator('.warehouse-problem-controls').screenshot({path:process.env.PROBLEM_BUTTON_PREVIEW});}
  }finally{await browser.close();}
});
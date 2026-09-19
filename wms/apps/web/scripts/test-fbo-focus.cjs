// TEST: real browser focus moves from the submit button to the KIZ input.
// Run with NODE_PATH pointing to Playwright, from apps/web.
const {build}=require('node:module').createRequire(require.resolve('vite'))('esbuild');
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {FboTwoStagePanel} from './src/components/client-requests/FboTwoStagePanel';
 const p={requestId:'focus-test',title:'test',phase:'PACKING',needed:1,picked:1,packed:0,shortage:0,wholeBoxes:[],route:[],boxes:[],lines:[{barcode:'123',picked:1,packed:0,requiresKiz:true}]};
 createRoot(document.getElementById('root')).render(<FboTwoStagePanel initial={p} accessToken="test" userId="test" canWrite onClose={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',plugins:[{name:'mock-api',setup(b){if(process.env.FBO_TEST_BEFORE)b.onLoad({filter:/FboTwoStagePanel\.tsx$/},args=>({contents:require('node:fs').readFileSync(args.path,'utf8').replace("setError('');field.current?.focus();","setError('');"),loader:'tsx'}));b.onLoad({filter:/[\\/]lib[\\/]api\.ts$/},()=>({contents:`export const actFbo=async(token,id,dto)=>({requestId:id,title:'test',phase:'PACKING',needed:1,picked:1,packed:0,shortage:0,wholeBoxes:[],route:[],boxes:[{code:'BOX',closed:false}],lines:[{barcode:'123',picked:1,packed:0,requiresKiz:true}]});export const fetchFboPlan=()=>{};export const downloadFboWbFile=()=>{};`,loader:'js'}));}}]});
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{const page=await browser.newPage();await page.route('http://localhost:49199/',r=>r.fulfill({body:'<div id="root"></div>',contentType:'text/html'}));await page.goto('http://localhost:49199/');await page.addScriptTag({content:result.outputFiles[0].text});
 await page.locator('input').fill('BOX');await page.getByRole('button',{name:'Подтвердить скан',exact:true}).click();await page.getByText('Открыт короб BOX',{exact:false}).waitFor();
 await page.locator('input').fill('wrong');await page.getByRole('button',{name:'Подтвердить скан',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('КИЗ товара',{exact:true}).count(),0);
 await page.locator('input').fill('123');await page.getByRole('button',{name:'Подтвердить скан',exact:true}).click();const kiz=page.getByLabel('КИЗ товара',{exact:true});await kiz.waitFor();assert.equal(await kiz.evaluate(el=>el===document.activeElement),true);assert.equal(await kiz.inputValue(),'');console.log('PASS: accepted barcode focuses empty KIZ field; invalid barcode cannot advance');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});



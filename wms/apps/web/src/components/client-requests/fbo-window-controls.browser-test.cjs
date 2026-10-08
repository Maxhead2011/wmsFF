const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const esbuild=require(process.env.ESBUILD_MODULE||'esbuild');
// TEST: real FBO and retained-window components, delayed reads and persisted uncertain writes.
test('FBO can minimize and close during refresh, and reconcile a pending operation',async()=>{
 let component="import{FboTwoStagePanel}from'./FboTwoStagePanel';";
 if(process.env.FBO_RUNTIME){
  const fs=require('node:fs'),ts=require(path.resolve(__dirname,'../../../../../node_modules/typescript'));
  const src=ts.createSourceFile('runtime.js',fs.readFileSync(process.env.FBO_RUNTIME,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  assert.equal(src.parseDiagnostics.length,0,'runtime must parse');
  const fn=src.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Bi');assert(fn);
  component=`import * as e from'react/jsx-runtime';const o=React,Ii=()=>null,Ci=()=>()=>{},Oa=()=>new Promise(resolve=>window.finishWrite=()=>resolve({...window.plan})),$a=()=>{window.reads=(window.reads||0)+1;return new Promise(resolve=>window.finishRead=()=>resolve({...window.plan}))};${fn.getText(src)}const FboTwoStagePanel=Bi;`;
 }
 const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';${component}import{PantheraWorkspaces}from'../layout/PantheraWorkspaces';
 window.plan={requestId:'r',number:1813,title:'Test FBO',phase:'NOT_STARTED',needed:5244,picked:0,packed:0,looseRemaining:0,shortage:58,compositionChanged:false,wholeBoxes:[],lines:[],route:[],boxes:[]};
 function Page(){const[open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Open</button>{open&&<FboTwoStagePanel initial={window.plan} accessToken='fixture' userId='fixture' canWrite onClose={()=>setOpen(false)}/>}</>}
 createRoot(document.getElementById('root')).render(<PantheraWorkspaces activeId='fbo' onOpen={()=>{}} render={()=><Page/>}/>);`;
 const bundle=await esbuild.build({stdin:{contents:entry,loader:'tsx',resolveDir:__dirname},bundle:true,write:false,format:'iife',loader:{'.css':'empty'},nodePaths:[path.resolve(__dirname,'../../../node_modules')],plugins:[{name:'fixture-api',setup(b){b.onLoad({filter:/[/\\]lib[/\\]api\.ts$/},()=>({contents:`export const fetchFboPlan=()=>{window.reads=(window.reads||0)+1;return new Promise(resolve=>window.finishRead=()=>resolve({...window.plan}))};export const actFbo=()=>new Promise(resolve=>window.finishWrite=()=>resolve({...window.plan}));export const downloadFboWbFile=()=>Promise.resolve(new Blob());`,loader:'js'}));}}]});
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage();
  await page.route('**/*',r=>r.fulfill({body:'<div id="root"></div>',contentType:'text/html'}));await page.goto('http://fixture.test');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByRole('button',{name:'Open',exact:true}).click();
  await page.getByRole('button',{name:'Обновить',exact:true}).click();
  await page.getByRole('button',{name:'Свернуть окно',exact:true}).click();
  assert.equal(await page.locator('.panthera-window-dock button').count(),1);
  await page.locator('.panthera-window-dock button').click();
  await page.getByRole('button',{name:'Закрыть',exact:true}).first().click();
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.evaluate(()=>{window.finishRead();localStorage.setItem('fbo-pending:fixture:r',JSON.stringify({action:'START',operationId:'retained'}));});
  await page.getByRole('button',{name:'Open',exact:true}).click();
  await page.getByRole('button',{name:'Обновить',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.reads),2);
  await page.getByRole('button',{name:'Закрыть',exact:true}).last().click();
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('fbo-pending:fixture:r'))).operationId,'retained');
  await page.getByRole('button',{name:'Open',exact:true}).click();
  await page.getByRole('button',{name:'Повторить неподтверждённый запрос',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Закрыть',exact:true}).first().isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Обновить',exact:true}).isDisabled(),true);
  await page.evaluate(()=>window.finishWrite());
  await page.getByRole('button',{name:'Закрыть',exact:true}).first().click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('fbo-pending:fixture:r')),null);
 }finally{await browser.close();}
});

// TEST: the shipped download handler and row buttons, not a rewritten mock implementation.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]);
async function main(){
 const asset='/assets/wb-document-actions-20261108.js';
 const s=process.env.PUBLIC_URL?await(await fetch(process.env.PUBLIC_URL+asset)).text():fs.readFileSync(root+'/web-payload'+asset,'utf8');
 const ast=ts.createSourceFile('fbs.js',s,99,true,ts.ScriptKind.JS);let handler,documents;
 function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='ga')handler=n.getText(ast);if(ts.isCallExpression(n)&&n.arguments[0]?.getText(ast)==='"div"'&&n.getText(ast).startsWith('e.jsxs("div",{className:"fbs-order-documents"'))documents=n.getText(ast);ts.forEachChild(n,visit)}visit(ast);assert(handler&&documents);
 const browser=await chromium.launch({channel:'msedge',headless:true});let passed=0;
 try{const page=await browser.newPage();await page.goto('about:blank');
  for(const scenario of ['complete','partial','old','error','print']){
   const result=await page.evaluate(async({handler,scenario})=>{
    const f='client',s={accessToken:'synthetic-token'},events=[];let busy;
    const be=value=>{busy=value},Fe=()=>{},ie=message=>events.push(['message',message]),le=message=>events.push(['error',message]),ke=o=>o.id,zs=()=> 'date';
    const Is=(blob,name)=>events.push(['file',blob.size,blob.type,name]);
    const __downloadWbAllLabels=async(token,body)=>{events.push(['all',token,body]);if(scenario==='error')throw Error('Не удалось получить этикетки');return{fileBase64:btoa('%PDF-test'),fileName:'all.pdf',pageCount:3,warnings:scenario==='partial'?['СЦ ещё не готов']:[]}};
    const En=async(token,body)=>{events.push(['old',token,body]);return new Blob(['old'])};
    const openWbRibbonPrint=async(token,client,result)=>events.push(['print',token,client,result.pageCount]);
    const invoke=eval('('+handler+')');await invoke([{id:'1',connectionId:'cabinet'}],scenario==='print'?'print':scenario!=='old');return{events,busy};
   },{handler,scenario});
   assert.equal(result.busy,null);
   const files=result.events.filter(e=>e[0]==='file');
   if(scenario==='print'){assert.equal(files.length,0);assert(result.events.some(e=>e[0]==='print'&&e[3]===3));}
   else if(scenario==='error'){assert.equal(files.length,0);assert(result.events.some(e=>e[0]==='error'&&e[1].includes('Не удалось')))}
   else{assert.equal(files.length,1);assert(result.events.some(e=>e[0]===(scenario==='old'?'old':'all')));}
   if(scenario==='partial')assert(result.events.some(e=>e[0]==='error'&&e[1].includes('Скачан неполный комплект. СЦ')));passed++;
  }
  for(const marketplace of ['WILDBERRIES','OZON']){
   await page.evaluate(({documents,marketplace})=>{
    const s={id:'1',marketplace,supplyId:'s',request:{number:1}},l=false,N=true,w=true,R=true,h=true,j=true,x=false,d=false,u=false,p=false,S=true;
    const calls=[];window.ribbonCalls=calls;const W=all=>calls.push(all),P=()=>{},$=()=>{},F=()=>{},Cs=()=>document.createTextNode('↓'),As=()=>document.createTextNode('▦'),Pn=()=>document.createTextNode('□'),ss=()=> 'WB';
    const e={jsx:make,jsxs:make,Fragment:'div'};function make(tag,props){if(typeof tag==='function')return tag(props);const node=document.createElement(tag);for(const[k,v]of Object.entries(props)){if(k==='children'){for(const c of[v].flat(Infinity))if(c!=null&&c!==false)node.append(c instanceof Node?c:document.createTextNode(String(c)));}else if(k==='className')node.className=v;else if(k==='onClick')node.onclick=v;else if(k==='disabled')node.disabled=v;else if(!k.startsWith('on'))node.setAttribute(k,v);}return node}
    document.body.innerHTML='<main style="padding:24px;max-width:440px"></main>';document.querySelector('main').append(eval(documents));
   },{documents,marketplace});
   if(marketplace==='WILDBERRIES'){assert.equal(await page.getByRole('button').count(),4);assert.equal(await page.getByRole('button',{name:/ШК для ПВЗ|ШК для СЦ/}).count(),0);await page.getByRole('button',{name:/Скачать все ШК$/}).click();assert.deepEqual(await page.evaluate(()=>window.ribbonCalls),[true]);await page.getByRole('button',{name:/Скачать ШК$/}).click();assert.deepEqual(await page.evaluate(()=>window.ribbonCalls),[true,undefined]);await page.getByRole('button',{name:/Печать всех ШК$/}).click();assert.deepEqual(await page.evaluate(()=>window.ribbonCalls),[true,undefined,'print']);await page.screenshot({path:root+'/ribbon-buttons.png'});}
   else assert.equal(await page.getByRole('button',{name:/Скачать все ШК$/}).count(),0);passed++;
  }
 }finally{await browser.close()}
 fs.writeFileSync(root+'/'+(process.env.PUBLIC_URL?'public-browser-proof.json':'runtime-browser-proof.json'),JSON.stringify({passed,syntheticOnly:true}));console.log({passed});
}main().catch(e=>{console.error(e);process.exitCode=1});

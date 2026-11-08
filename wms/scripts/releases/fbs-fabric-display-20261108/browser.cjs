// TEST: render the actual published stock-cell expression, including both conditional branches.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]);
async function main(){
 const asset='/assets/fabric-reservation-fbs-20261108.js';
 const s=process.env.PUBLIC_URL?await (await fetch(process.env.PUBLIC_URL+asset)).text():fs.readFileSync(root+'/web-payload'+asset,'utf8');
 const ast=ts.createSourceFile('web.js',s,99,true,ts.ScriptKind.JS);let cell;
 function visit(n){if(ts.isCallExpression(n)&&n.arguments[0]?.getText(ast)==='"td"'&&n.getText(ast).includes('fbs-missing-box'))cell=n;ts.forEachChild(n,visit)}visit(ast);assert(cell);
 const expression=cell.getText(ast);const browser=await chromium.launch({channel:'msedge',headless:true});let passed=0;
 try{
  const page=await browser.newPage();await page.goto('https://wms.logoff.pro/',{waitUntil:'networkidle'});
  for(const status of ['FABRIC_ON_DEMAND','WAITING_STOCK']){
   await page.evaluate(({expression,status})=>{
    const s={reservation:{status,withoutBox:status==='FABRIC_ON_DEMAND',problem:'Нет доступного товара'},storageBoxes:[]};
    const e={jsx:make,jsxs:make};function make(tag,props){const node=document.createElement(tag);for(const[k,v]of Object.entries(props)){if(k==='children'){for(const c of [v].flat(Infinity))if(c!==null&&c!==undefined)node.append(c instanceof Node?c:document.createTextNode(String(c)));}else if(k==='className')node.className=v;else if(!k.startsWith('on'))node.setAttribute(k,v)}return node}
    let oe,ve,re,Ne;const f=true,k=()=>{};
    const node=eval(expression);document.body.innerHTML='<main style="padding:24px;max-width:600px"><table><tbody><tr></tr></tbody></table></main>';document.querySelector('tr').append(node);
   },{expression,status});
   const text=await page.locator('main').innerText();
   if(status==='FABRIC_ON_DEMAND'){assert(text.includes('Нарезка по факту'));assert(!text.includes('короб не найден'));assert(!text.includes('Резерв ожидает'));assert.equal(await page.locator('main button').count(),0);await page.screenshot({path:root+'/fabric-preview.png'});}
   else {assert(text.includes('Резерв ожидает'));assert(text.includes('короб не найден'));assert(text.includes('Нет доступного товара'));assert.equal(await page.locator('main button').count(),1);}
   passed++;
  }
 }finally{await browser.close()}
 fs.writeFileSync(root+'/'+(process.env.PUBLIC_URL?'public-browser-proof.json':'runtime-browser-proof.json'),JSON.stringify({passed,syntheticOnly:true}));console.log({passed});
}
main().catch(e=>{console.error(e);process.exitCode=1});

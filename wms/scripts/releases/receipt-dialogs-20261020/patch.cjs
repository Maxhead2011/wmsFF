const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root=process.argv[2],base=path.join(root,'web-base'),out=path.join(root,'web');
const old='invoice-purpose-20261020-0.js',next='receipt-dialogs-20261020.js';
let s=fs.readFileSync(path.join(base,'assets',old),'utf8');
const ast=ts.createSourceFile('x.js',s,99,true),edits=[];
function walk(n){
 if(ts.isCallExpression(n)&&n.expression.getText(ast)==='e.createElement'&&n.arguments[0]?.text==='div'){
  const props=n.arguments[1]?.getText(ast)||'';
  if(props.includes('role: "region"')&&(props.includes('marginBottom: 16')||props.includes('padding: 16'))){
   const parent=n.parent.getText(ast);
   const mode=parent.startsWith('approval &&')?'approval':parent.startsWith('preview &&')?'preview':null;
   if(mode){
    const heading=n.arguments[2];assert(ts.isCallExpression(heading));
    const title=heading.arguments.slice(2).map(a=>a.getText(ast)).join(',');
    const children=n.arguments.slice(3).map(a=>a.getText(ast)).join(',');
    edits.push([n.getStart(ast),n.end,`e.createElement(__ReceiptConfirmation,{title:e.createElement(e.Fragment,null,${title}),busy,message,onCancel:()=>${mode==='approval'?'setApproval':'setPreview'}(null)},${children})`]);
   }
  }
 }
 ts.forEachChild(n,walk);
}
walk(ast);assert.equal(edits.length,2);
for(const[a,b,v]of edits.sort((a,b)=>b[0]-a[0]))s=s.slice(0,a)+v+s.slice(b);
let src=fs.readFileSync(path.join(__dirname,'../../../apps/web/src/components/warehouse/ReceiptConfirmation.tsx'),'utf8');
src=src.replace(/^import .*;\r?\n/gm,'').replace('export function ReceiptConfirmation','function __ReceiptConfirmation');
const helper=esbuild.transformSync('const __receiptHooks=e;\n'+src.replace('const ref = useRef','const ref = __receiptHooks.useRef').replace('const titleId = useId','const titleId = __receiptHooks.useId').replace('  useEffect(', '  __receiptHooks.useEffect('),{loader:'tsx',jsxFactory:'e.createElement',target:'es2020'}).code;
// FIX: React alias e belongs to the receipt IIFE, not to the entry module.
assert.equal(s.split('function X({ session, fixedClientId })').length,2);
s=s.replace('function X({ session, fixedClientId })',helper+'\nfunction X({ session, fixedClientId })');
assert.equal(ts.createSourceFile('x.js',s,99,true).parseDiagnostics.length,0);
fs.mkdirSync(path.join(out,'assets'),{recursive:true});fs.writeFileSync(path.join(out,'assets',next),s);
let html=fs.readFileSync(path.join(base,'index.html'),'utf8');
// Preserve every live overlay; redirect all imports of the React-owning entry.
html=html.replaceAll('/assets/'+old,'/assets/'+next);
html=html.replace('{"imports":{','{"imports":{"/assets/'+old+'":"/assets/'+next+'",');
const css='assets/receipt-confirmation-20261020.css';
html=html.replace('</head>',`<link rel="stylesheet" href="/${css}">\n</head>`);
fs.writeFileSync(path.join(out,'index.html'),html);
fs.copyFileSync(path.join(__dirname,'../../../apps/web/src/components/warehouse/receipt-confirmation.css'),path.join(out,css));
fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(['index.html','assets/'+next,css]));
console.log('Patched exactly two confirmation expressions; preserved other runtime code.');

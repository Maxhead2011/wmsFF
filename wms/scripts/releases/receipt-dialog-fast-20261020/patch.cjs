const fs=require('fs'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const root=process.argv[2],old='receipt-dialog-effective-20261020.js',next='receipt-dialog-fast-20261020.js';
let s=fs.readFileSync(root+'/web-base/assets/'+old,'utf8');
const ast=ts.createSourceFile('x',s,99,true);
const declarations=ast.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='__ReceiptDirections'));
assert.equal(declarations.length,2);
const effective=declarations.at(-1),edits=[];
function walk(n){
 if(ts.isFunctionDeclaration(n)&&n.name?.text==='W'){
  let v=n.getText(ast);assert(v.includes('/warehouse/receipt-channels/approval'));
  // FIX: render immediately; preserve the server preflight and disable confirmation until it succeeds.
  assert(v.includes('p(!0),l("");try{'));
  v=v.replace('p(!0),l("");try{','p(!0),l("");if(!a)A({row:e,available:t,checking:true});try{');
  assert(v.includes('i===b.current&&l(v.message)'));
  v=v.replace('i===b.current&&l(v.message)','i===b.current&&(!a&&A(null),l(v.message))');
  edits.push([n.getStart(ast),n.end,v]);
 }
 if(ts.isFunctionDeclaration(n)&&n.name?.text==='__EffectiveReceiptModal'){
  let v=n.getText(ast).replace('children,busy,onDismiss','children,busy,checking,message,onDismiss');
  v=v.replace('},children)}','},message&&n.createElement("p",{role:"status"},message),busy&&n.createElement("p",{role:"status",className:"receipt-confirmation__progress"},checking?"Проверяем доступность…":"Сохраняем…"),children)}');
  assert(v.includes('receipt-confirmation__progress'));edits.push([n.getStart(ast),n.end,v]);
 }
 if(ts.isCallExpression(n)&&n.arguments[0]?.getText(ast)==='__EffectiveReceiptModal'){
  const p=n.arguments[1],v=p.getText(ast);
  edits.push([p.getStart(ast),p.end,v.replace('busy:o,','busy:o,message:L,checking:!!f?.checking,')]);
 }
 ts.forEachChild(n,walk);
}
walk(effective);assert.equal(edits.length,4);
for(const[a,b,v]of edits.sort((a,b)=>b[0]-a[0]))s=s.slice(0,a)+v+s.slice(b);
assert.equal(ts.createSourceFile('x',s,99,true).parseDiagnostics.length,0);
fs.mkdirSync(root+'/web/assets',{recursive:true});fs.writeFileSync(root+'/web/assets/'+next,s);
const css='receipt-dialog-fast-20261020.css';
fs.copyFileSync(require('path').resolve(__dirname,'../../../apps/web/src/components/warehouse/receipt-confirmation.css'),root+'/web/assets/'+css);
let html=fs.readFileSync(root+'/web-base/index.html','utf8').replaceAll('/assets/'+old,'/assets/'+next);
html=html.replace('{"imports":{','{"imports":{"/assets/'+old+'":"/assets/'+next+'",');
html=html.replace('</head>',`<link rel="stylesheet" href="/assets/${css}"></head>`);
fs.writeFileSync(root+'/web/index.html',html);
fs.writeFileSync(root+'/web-changes.json',JSON.stringify(['index.html','assets/'+next,'assets/'+css]));

const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const root=process.argv[2],old='receipt-dialog-scope-20261020.js',next='receipt-dialog-effective-20261020.js';
let s=fs.readFileSync(root+'/web-base/assets/'+old,'utf8');
const ast=ts.createSourceFile('x',s,99,true);
const declarations=ast.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='__ReceiptDirections'));
assert.equal(declarations.length,2);
const effective=declarations.at(-1),edits=[];
function walk(n){
 if(ts.isCallExpression(n)&&n.expression.getText(ast)==='n.createElement'&&n.arguments[0]?.text==='div'){
  const props=n.arguments[1];
  if(ts.isObjectLiteralExpression(props)){
   const label=props.properties.find(p=>p.name?.getText(ast)==='"aria-label"')?.initializer?.text;
   if(['Подтверждение доступа','Проверка направлений'].includes(label)){
    const buttons=n.arguments.filter(a=>ts.isCallExpression(a)&&a.arguments[0]?.text==='button');
    assert.equal(buttons.length,2);
    const p=buttons.at(-1).arguments[1];
    const cancel=p.properties.find(p=>p.name.getText(ast)==='onClick').initializer.getText(ast);
    const busy=p.properties.find(p=>p.name.getText(ast)==='disabled').initializer.getText(ast);
    edits.push([n.getStart(ast),n.end,`n.createElement(__EffectiveReceiptModal,{"aria-label":${JSON.stringify(label)},busy:${busy},onDismiss:${cancel}},${n.arguments.slice(2).map(a=>a.getText(ast)).join(',')})`]);
   }
  }
 }
 ts.forEachChild(n,walk);
}
walk(effective);assert.equal(edits.length,2);
for(const[a,b,v]of edits.sort((a,b)=>b[0]-a[0]))s=s.slice(0,a)+v+s.slice(b);
const marker='function se(';
const pos=s.indexOf(marker,effective.getStart(ast));assert(pos>effective.getStart(ast)&&pos<effective.end);
assert(s.includes(marker));
// FIX: helper is inside the final effective receipt closure, retaining all live callbacks.
const helper=`function __EffectiveReceiptModal({children,busy,onDismiss,...props}){const ref=n.useRef(null);n.useEffect(()=>{const d=ref.current,previous=document.activeElement;d.showModal();return()=>{d.close();previous?.focus()}},[]);return n.createElement("dialog",{...props,ref,className:"receipt-confirmation","aria-modal":true,onCancel:event=>{event.preventDefault();if(!busy)onDismiss()}},children)}\n`;
s=s.slice(0,pos)+helper+s.slice(pos);
assert.equal(ts.createSourceFile('x',s,99,true).parseDiagnostics.length,0);
fs.mkdirSync(root+'/web/assets',{recursive:true});fs.writeFileSync(root+'/web/assets/'+next,s);
let html=fs.readFileSync(root+'/web-base/index.html','utf8').replaceAll('/assets/'+old,'/assets/'+next);
html=html.replace('{"imports":{','{"imports":{"/assets/'+old+'":"/assets/'+next+'",');
fs.writeFileSync(root+'/web/index.html',html);
fs.writeFileSync(root+'/web-changes.json',JSON.stringify(['index.html','assets/'+next]));
console.log('Patched final effective panel: 2 confirmations');

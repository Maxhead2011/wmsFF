// FIX: patch only the reviewed methods/components in the current production baseline.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]);
const read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const ast=(s,name='file.js')=>ts.createSourceFile(name,s,99,true,ts.ScriptKind.JS);
const compile=(s,jsx=false)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:jsx?ts.ModuleKind.ESNext:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true,...(jsx?{jsx:ts.JsxEmit.React,jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}:{})}}).outputText;
const apiNames=['ozon-stock-adjustment.service','ozon-adjustment-result'];
const methods=['view','resume'];
for(const name of apiNames){let s=compile(read('apps/api/src/modules/tsd/'+name+'.ts'));
 if(name.endsWith('service')){
  let live=read(root+'/api-base/modules/tsd/'+name+'.js');const old=ast(live),next=ast(s),find=a=>{let c;function visit(n){if(ts.isClassExpression(n)&&n.name?.text==='OzonStockAdjustmentService')c=n;ts.forEachChild(n,visit)}visit(a);assert(c);return c};
  const prev=find(old),current=find(next),edits=[];
  for(const m of methods){const n=current.members.find(x=>x.name?.getText(next)===m);assert(n);const p=prev.members.find(x=>x.name?.getText(old)===m);edits.push({start:p?p.getStart(old):prev.members.end,end:p?p.end:prev.members.end,text:n.getText(next)+'\n'});}
  for(const e of edits.sort((a,b)=>b.start-a.start))live=live.slice(0,e.start)+e.text+live.slice(e.end);
  s='const ozon_adjustment_result_1 = require("./ozon-adjustment-result");\n'+live;
  const patched=find(ast(s));for(const m of prev.members.filter(n=>!methods.includes(n.name?.getText(old)))){assert.equal(patched.members.find(n=>n.name?.getText()===m.name?.getText(old))?.getText(),m.getText(old));}
 }
 assert.equal(ast(s).parseDiagnostics.length,0);write(root+'/api-payload/modules/tsd/'+name+'.js',s);
}
write(root+'/api-changes.json',JSON.stringify(apiNames.map(n=>'modules/tsd/'+n+'.js')));
let source=read('apps/web/src/components/client-requests/OzonStockAdjustment.tsx');const sourceAst=ts.createSourceFile('panel.tsx',source,99,true,ts.ScriptKind.TSX);
for(const n of [...sourceAst.statements].reverse())if(ts.isImportDeclaration(n))source=source.slice(0,n.pos)+source.slice(n.end);
source=source.replace('export function OzonStockAdjustment','function OzonStockAdjustment');
const factory=`export function createPhysicalPanel(React){const {useState,useEffect,useRef}=React;
 async function ozonAdjustment(token,id,action,body={}){const response=await fetch('/api/v1/tsd/requests/'+encodeURIComponent(id)+'/fbo/ozon-adjustment'+(action?'/'+action:''),{method:action?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(action?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(Array.isArray(data.message)?data.message.join('; '):data.message??'HTTP '+response.status);return data;}
 const ozonSync=ozonAdjustment;
 ${compile(source,true).replace(/export\s*\{\s*\};?/g,'')}
 return OzonStockAdjustment;}`;
const panel='/assets/ozon-errors-panel-20261107.js';write(root+'/web-payload'+panel,factory);assert.equal(ast(factory).parseDiagnostics.length,0);
let html=read(root+'/web-base/index.html');const match=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(match[1]);const changed=[];
const targets=['requests','workspace','client-controls'];
for(const target of targets){
 const old='/assets/ozon-physical-'+target+'-20261107.js',next='/assets/ozon-errors-'+target+'-20261107.js';
 const original=read(root+'/web-base'+old);assert(original.includes('/assets/ozon-physical-panel-20261107.js'));
 const text=original.replace('/assets/ozon-physical-panel-20261107.js',panel);assert.equal(ast(text).parseDiagnostics.length,0);
 let count=0;for(const k of Object.keys(map.imports))if(map.imports[k]===old){map.imports[k]=next;count++;}assert(count);map.imports[old]=next;
 write(root+'/web-payload'+next,text);changed.push(next.slice(1));
}html=html.replace(match[1],()=>JSON.stringify(map));
write(root+'/web-payload/index.html',html);
write(root+'/web-changes.json',JSON.stringify(['index.html',...changed,panel.slice(1)]));
write(root+'/overlay-proof.json',JSON.stringify({api:apiNames,methods,webFunctions:4,existingMethodsPreserved:true,existingWebAssetsPreserved:true}));console.log('Prepared API2 and web5 overlay. Unmodified service methods preserved byte-for-byte.');

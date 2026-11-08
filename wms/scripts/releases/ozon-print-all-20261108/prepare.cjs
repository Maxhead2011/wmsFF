// FIX: exact additions to the current runtime; never replace unrelated application logic.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]);
const read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const compile=p=>ts.transpileModule(read(p),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
const changes=[];
function patch(file,pairs){let s=read(root+'/api-base/'+file),base=s;for(const[a,b]of pairs){assert.equal(s.split(a).length,2,a);s=s.replace(a,b)}let inverse=s;for(const[a,b]of [...pairs].reverse())inverse=inverse.replace(b,a);assert.equal(inverse,base);write(root+'/api-payload/'+file,s);changes.push(file)}
function member(s,name){const ast=ts.createSourceFile('a.js',s,99,true);let found=[];function walk(n){if(ts.isMethodDeclaration(n)&&n.name.getText(ast)===name)found.push(n.getText(ast));ts.forEachChild(n,walk)}walk(ast);assert.equal(found.length,1);return found[0]}
const folder='modules/client-requests/',source='apps/api/src/'+folder;
const service=compile(source+'ozon-assembly-supply.service.ts');
patch(folder+'ozon-assembly-supply.service.js',[
 ['const common_1 = require("@nestjs/common");','const common_1 = require("@nestjs/common");\nconst ozon_print_labels_1 = require("./ozon-print-labels");'],
 ['    db;','    '+member(service,'printLabels')+'\n    db;']
]);
const ctrl=compile(source+'ozon-assembly-supply.controller.ts');
const dec=ctrl.match(/__decorate\(\[\n    \(0, common_1.Post\)\('print-labels'\)[\s\S]*?OzonAssemblySupplyController.prototype, "printLabels", null\);/)[0];
patch(folder+'ozon-assembly-supply.controller.js',[
 ['    view(id, user)', '    '+member(ctrl,'printLabels')+'\n    view(id, user)'],
 ['exports.OzonAssemblySupplyController = OzonAssemblySupplyController;', 'exports.OzonAssemblySupplyController = OzonAssemblySupplyController;\n'+dec]
]);
write(root+'/api-payload/'+folder+'ozon-print-labels.js',compile(source+'ozon-print-labels.ts'));changes.push(folder+'ozon-print-labels.js');
const reg='modules/administration/administration-internal-api.service.js',r=read(root+'/api-base/'+reg),match=r.match(/id: 'client-requests',[\s\S]*?routeCount: (\d+)/);assert(match);patch(reg,[[match[0],match[0].replace(/routeCount: \d+/, 'routeCount: '+(Number(match[1])+1))]]);
fs.cpSync(root+'/api-base',root+'/api-candidate',{recursive:true});fs.cpSync(root+'/api-payload',root+'/api-candidate',{recursive:true});write(root+'/api-changes.json',JSON.stringify(changes));
// Shared component uses the already-loaded React instance, not a second application entry.
let sourceWeb=['apps/web/src/lib/printSeries.ts','apps/web/src/lib/ozonAllLabels.ts','apps/web/src/components/ozon-fbo/OzonPrintAllLabels.tsx'].map(p=>read(p).replace(/^import .*?;\r?\n/gm,'').replace(/export /g,'').replace("import.meta.env.VITE_API_URL??'/api/v1'","'/api/v1'")).join('\n');
const component=ts.transpileModule(sourceWeb,{compilerOptions:{target:99,module:99,jsx:ts.JsxEmit.React,jsxFactory:'React.createElement'}}).outputText;
const componentUrl='/assets/ozon-print-all-component-20261108.js';write(root+'/web-payload'+componentUrl,'export function createOzonPrintAll(React){const {useRef,useState}=React;\n'+component+'\nreturn OzonPrintAllLabels;\n}\n');
const replacements=[],webFiles=['index.html',componentUrl.slice(1)];let patched=0;
for(const kind of ['requests','workspace']){
 const old='/assets/ozon-errors-'+kind+'-20261107.js',next='/assets/ozon-print-all-'+kind+'-20261108.js';let web=read(root+'/web-base'+old),base=web;
 const ast=ts.createSourceFile('a.js',web,99,true),pairs=[];
 function walk(n){if(ts.isFunctionDeclaration(n)){
  const text=n.getText(ast);let a,b;
  if(n.name.text==='OzonAssemblySupply'&&text.includes('cargoMappingReady')){a='          Object.keys(data.link.operations).length';b='          !bindingOnly && jsx(__AllOzonLabels, {requestId, accessToken, ready: mappingReady && !busy}, requestId),\n'+a;}
  if(kind==='workspace'&&n.name.text==='be'&&text.includes('bindingOnly')){a='Object.keys(u.link.operations).length';b='!m&&n.createElement(__AllOzonLabels,{key:o,requestId:o,accessToken:l,ready:q&&!k}),'+a;}
  if(kind==='workspace'&&n.name.text==='Z'&&text.includes('bindingOnly')){a='Object.keys(a.link.operations).length';b='!p&&o.createElement(__AllOzonLabels,{key:r,requestId:r,accessToken:i,ready:M&&!u}),'+a;}
  if(a){assert.equal(text.split(a).length,2);pairs.push([text,text.replace(a,b)]);}
 }ts.forEachChild(n,walk)}walk(ast);
 assert.equal(pairs.length,kind==='requests'?1:2);for(const[a,b]of pairs)web=web.replace(a,b);let inverse=web;for(const[a,b]of pairs)inverse=inverse.replace(b,a);assert.equal(inverse,base);patched+=pairs.length;
 web='import {createOzonPrintAll as __createAllOzonLabels} from "'+componentUrl+'";let __allOzonLabels;function __AllOzonLabels(props){return (__allOzonLabels??=__createAllOzonLabels('+(kind==='requests'?'o':'h')+'))(props);}\n'+web;
 assert.equal(ts.createSourceFile('a.js',web,99,true).parseDiagnostics.length,0);write(root+'/web-payload'+next,web);replacements.push([old,next]);webFiles.push(next.slice(1));
}
let html=read(root+'/web-base/index.html'),mapMatch=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(mapMatch[1]);
for(const[old,next]of replacements){let n=0;for(const k in map.imports)if(map.imports[k]===old){map.imports[k]=next;n++}assert(n);map.imports[old]=next;}
html=html.replace(mapMatch[1],()=>JSON.stringify(map));write(root+'/web-payload/index.html',html);
write(root+'/web-changes.json',JSON.stringify(webFiles));write(root+'/overlay-proof.json',JSON.stringify({apiFiles:changes.length,webFiles:webFiles.length,panels:patched,existingBytesPreserved:true}));console.log('API4/web4, three existing panels preserved');

const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),crypto=require('crypto');
const repo=path.resolve(__dirname,'../../../..'),r=path.resolve(process.argv[2]),ts=require(repo+'/wms/node_modules/typescript'),base=JSON.parse(fs.readFileSync(r+'/base.json'));
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true},compile=s=>ts.transpileModule(s,{compilerOptions:options}).outputText,norm=s=>s.replace(/\r\n/g,'\n').trim(),old=n=>cp.execFileSync('git',['show','491c6c5c:'+n],{cwd:repo,encoding:'utf8',maxBuffer:16777216});
const apiChanges=[],webChanges=[];
function api(n,s){apiChanges.push(n);for(const dir of ['api','candidate']){const file=r+'/'+dir+'/'+n;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,s);}}
function web(n,s){webChanges.push(n);const file=r+'/web/'+n;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,s);}
function verified(n,local){const data=fs.readFileSync(r+'/'+local);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),base.webFiles[n]);return data.toString('utf8');}
for(const n of ['wb-all-labels']){const src='wms/apps/api/src/modules/marketplace-connections/'+n+'.ts',dist='modules/marketplace-connections/'+n+'.js';assert.equal(norm(compile(old(src))),norm(fs.readFileSync(r+'/base-api/'+dist,'utf8')),n+' source parity');api(dist,compile(fs.readFileSync(repo+'/'+src,'utf8')));}
// FIX: deployed DTO differs from source; append only the two new boolean validators.
const dtoPath='modules/marketplace-connections/dto/fbs-order-selection.dto.js';let dto=fs.readFileSync(r+'/base-api/'+dtoPath,'utf8');
const dtoCompiled=compile(fs.readFileSync(repo+'/wms/apps/api/src/modules/marketplace-connections/dto/fbs-order-selection.dto.ts','utf8'));
for(const name of ['cargoLabelsOnly','prepareWbCargo']){assert(!dto.includes('"'+name+'"'));const end=dtoCompiled.indexOf('], FbsOrderSelectionDto.prototype, "'+name+'", void 0);');assert(end>0);const start=dtoCompiled.lastIndexOf('__decorate([',end);dto+='\n'+dtoCompiled.slice(start,dtoCompiled.indexOf(';',end)+1);}
api(dtoPath,dto);
api('modules/marketplace-connections/wb-print-cargo.js',compile(fs.readFileSync(repo+'/wms/apps/api/src/modules/marketplace-connections/wb-print-cargo.ts','utf8')));
function method(s,name){const ast=ts.createSourceFile('s.js',s,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);let found;function visit(n){if(ts.isMethodDeclaration(n)&&n.name.getText(ast)===name)found=n;ts.forEachChild(n,visit);}visit(ast);assert(found,name);return s.slice(found.getStart(ast),found.end);}
const src='wms/apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts',dist='modules/marketplace-connections/marketplace-connections.service.js';let service=fs.readFileSync(r+'/base-api/'+dist,'utf8');
const adapt=s=>s.replaceAll('(0, wb_all_labels_1.wbAllLabels)','require("./wb-all-labels").wbAllLabels').replaceAll('(0, fbs_ribbon_evidence_1.rememberRibbon)','fbs_ribbon_evidence_1.rememberRibbon');
const tokens=s=>{const scan=ts.createScanner(ts.ScriptTarget.ES2022,true,ts.LanguageVariant.Standard,s),out=[];let kind;while((kind=scan.scan())!==ts.SyntaxKind.EndOfFileToken)out.push([kind,kind===ts.SyntaxKind.StringLiteral?scan.getTokenValue():scan.getTokenText()]);return JSON.stringify(out);};
const before=adapt(method(compile(old(src)),'getFbsAllLabels')),actual=method(service,'getFbsAllLabels');assert.equal(tokens(before),tokens(actual),'Only documented import invocation/comment/quote differences allowed');
service=service.replace(actual,adapt(method(compile(fs.readFileSync(repo+'/'+src,'utf8')),'getFbsAllLabels')));service='const wb_print_cargo_1 = require("./wb-print-cargo");\n'+service;api(dist,service);
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,a);return s.replace(a,b);};
(async()=>{
 const esbuild=require(repo+'/wms/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild');
 const bundle=await esbuild.build({entryPoints:[repo+'/wms/apps/web/src/components/client-requests/FbsLabelActions.tsx'],bundle:true,write:false,format:'esm',target:'es2022',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},jsxFactory:'React.createElement',jsxFragment:'React.Fragment',external:['/assets/storage-volume-root-20261109.js'],plugins:[{name:'live-react',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'live-react'}));b.onLoad({filter:/.*/,namespace:'live-react'},()=>({contents:`import{r as R}from'/assets/storage-volume-root-20261109.js';export default R;export const forwardRef=R.forwardRef,createElement=R.createElement;`,loader:'js'}));}}]});
 web('assets/fbs-label-actions-20261125.js',bundle.outputFiles[0].contents);
 let table=verified('assets/fbo-whole-remaining-20261121.js','fbo-whole-remaining-20261121.js');
 table=once(table,'e.jsxs("div",{className:"request-action-menu__items",children:[e.jsx("button",{type:"button",onClick:()=>{__setSupplyTarget({request:c,action:"download"});le(c)},children:"Скачать все ШК"}),e.jsx("button",{type:"button",onClick:()=>{__setSupplyTarget({request:c,action:"print"});le(c)},children:"Распечатать все ШК"})]})','e.jsx("div",{className:"request-action-menu__items",children:e.jsx(__FbsLabelActions,{onAction:action=>{__setSupplyTarget({request:c,action});le(c)}})})');
 web('assets/fbs-cargo-buttons-20261125.js','import{FbsLabelActions as __FbsLabelActions}from"/assets/fbs-label-actions-20261125.js";\n'+table);
 let fbs=verified('assets/fbs-request-progress-20261125.js','fbs-request-progress-20261125.js');
 fbs=once(fbs,'if(all===true||all==="print"){','if(all===true||all==="print"||all==="cargo"){');
 fbs=once(fbs,'target.action==="print"?"print":true','target.action==="cargo"?"cargo":target.action==="print"?"print":true');
 const a=fbs.indexOf('const result=await __downloadWbAllLabels'),b=fbs.indexOf('if(all==="print")',a);assert(a>0&&b>a);let call=fbs.slice(a,b);assert(call.includes('orders:o.map'));
 call=once(call,'__downloadWbAllLabels','__cargoLabelDownload');const close=call.lastIndexOf('});');assert(close>0);call=call.slice(0,close)+'},all==="cargo",all==="cargo"||all==="print");'+call.slice(close+3);fbs=fbs.slice(0,a)+call+fbs.slice(b);
 fbs=once(fbs,'if(all==="print"){ie("Открываю выбор принтера…")','if(all==="print"||all==="cargo"){ie("Открываю выбор принтера…")');
 fbs=once(fbs,'from "./ozon-documents-print-dialog-20261110.js"','from "/assets/fbs-cargo-print-dialog-20261125.js"');
 const helper=`async function __cargoLabelDownload(token,payload,cargoLabelsOnly,prepareWbCargo){const response=await fetch('/api/v1/marketplace-connections/fbs/orders/all-labels',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({...payload,...(cargoLabelsOnly?{cargoLabelsOnly:true}:{}),...(prepareWbCargo?{prepareWbCargo:true}:{})})});const data=await response.json();if(!response.ok)throw Error(Array.isArray(data.message)?data.message.join(' '):data.message||'Не удалось получить стикеры.');return data;}\n`;
 web('assets/fbs-cargo-flow-20261125.js',helper+fbs);
 const printSrc=fs.readFileSync(repo+'/wms/apps/web/src/lib/wbRibbonPrint.ts','utf8');web('assets/fbs-cargo-print-dialog-20261125.js',ts.transpileModule(printSrc,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
 let html=verified('index.html','index-base.html');assert(html.includes('/assets/fbo-whole-remaining-20261121.js'));html=html.replaceAll('/assets/fbo-whole-remaining-20261121.js','/assets/fbs-cargo-buttons-20261125.js').replaceAll('/assets/fbs-request-progress-20261125.js','/assets/fbs-cargo-flow-20261125.js');web('index.html',html);
 fs.writeFileSync(r+'/api-changes.json',JSON.stringify(apiChanges));fs.writeFileSync(r+'/web-changes.json',JSON.stringify(webChanges));console.log(JSON.stringify({api:apiChanges,web:webChanges}));
})().catch(e=>{console.error(e);process.exitCode=1});


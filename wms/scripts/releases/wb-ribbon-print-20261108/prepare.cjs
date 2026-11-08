// FIX: exact additions to current runtime; never replace unrelated source/runtime differences.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const compile=(s,module=ts.ModuleKind.CommonJS)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
const changes=[];
function patch(file,pairs,kind='api'){let s=read(root+'/'+kind+'-base/'+file),base=s;for(const[a,b]of pairs){assert.equal(s.split(a).length,2,a.slice(0,80));s=s.replace(a,b)}let inverse=s;for(const[a,b]of [...pairs].reverse())inverse=inverse.replace(b,a);assert.equal(inverse,base);write(root+'/'+kind+'-payload/'+file,s);changes.push(file);return s;}
const service=compile(read('apps/api/src/modules/print/print-series.service.ts'));
const ast=ts.createSourceFile('a.js',service,99,true);let method;function walk(n){if(ts.isMethodDeclaration(n)&&n.name.getText(ast)==='createPdf')method=n.getText(ast);ts.forEachChild(n,walk)}walk(ast);assert(method);
patch('modules/print/print-series.service.js',[
 ['const key = (id)', 'const pdf_series_1 = require("./pdf-series");\nconst key = (id)'],
 ['    async create(body, user) {','    '+method+'\n    async create(body, user) {']
]);
const c='modules/print/print-series.controller.js',ctrl=read(root+'/api-base/'+c);
const end=ctrl.indexOf('], PrintSeriesController.prototype, "create", null);'),start=ctrl.lastIndexOf('__decorate([',end);assert(start>0);
const dec=ctrl.slice(start,end)+'], PrintSeriesController.prototype, "create", null);';
patch(c,[['    create(b, u) {','    createPdf(b,u) { return this.service.createPdf(b ?? {},u); }\n    create(b, u) {'],[dec,dec+'\n'+dec.replace("('jobs')","('pdf-jobs')").replace('"create", null','"createPdf", null')]]);
const helper='modules/print/pdf-series.js';write(root+'/api-payload/'+helper,compile(read('apps/api/src/modules/print/pdf-series.ts')));changes.push(helper);
const reg='modules/administration/administration-internal-api.service.js',s=read(root+'/api-base/'+reg),m=s.match(/id: 'print',[\s\S]{0,400}?routeCount: (\d+)/);assert(m);patch(reg,[[m[0],m[0].replace('routeCount: '+m[1],'routeCount: '+(Number(m[1])+1))]]);
write(root+'/api-changes.json',JSON.stringify(changes));fs.cpSync(root+'/api-base',root+'/api-candidate',{recursive:true});fs.cpSync(root+'/api-payload',root+'/api-candidate',{recursive:true});
const old='assets/wb-all-labels-fbs-20261108.js',next='assets/wb-ribbon-print-fbs-20261108.js';let web=read(root+'/web-base/'+old),base=web,pairs=[];
function once(a,b){assert.equal(web.split(a).length,2,a.slice(0,90));web=web.replace(a,b);pairs.push([a,b]);}
once('if(all===true){','if(all===true||all==="print"){');
const after='const bytes=Uint8Array.from(atob(result.fileBase64),c=>c.charCodeAt(0));';
once(after,'if(all==="print"){await openWbRibbonPrint(s.accessToken,f,result);return;}'+after);
// Reuse the exact existing selection wiring for order, supply and multi-selection buttons.
const tree=ts.createSourceFile('fbs.js',web,99,true);const buttons=[];
function find(n){if(ts.isCallExpression(n)&&n.expression.getText(tree)==='e.jsxs'&&n.arguments[0]?.getText(tree)==='"button"'&&/"(?:Скачать все ШК|Все ШК)"/.test(n.getText(tree)))buttons.push(n.getText(tree));ts.forEachChild(n,find)}find(tree);assert.equal(buttons.length,3);
for(const button of buttons){const copy=button.replace(/,true\)/g,',"print")').replace(/W\(true\)/g,'W("print")').replace(/"(?:Скачать все ШК|Все ШК)"/g,'"Печатать все ШК"');assert.notEqual(copy,button);once(button,`e.jsxs(e.Fragment,{children:[${button},${copy}]})`);}
let inverse=web;for(const[a,b]of [...pairs].reverse())inverse=inverse.replace(b,a);assert.equal(inverse,base);
web='import {openWbRibbonPrint} from "./wb-ribbon-print-dialog-20261108.js";\n'+web;
assert.equal(ts.createSourceFile('fbs.js',web,99,true,ts.ScriptKind.JS).parseDiagnostics.length,0);write(root+'/web-payload/'+next,web);
const dialog='assets/wb-ribbon-print-dialog-20261108.js';write(root+'/web-payload/'+dialog,compile(read('apps/web/src/lib/wbRibbonPrint.ts'),ts.ModuleKind.ES2022));
let html=read(root+'/web-base/index.html'),match=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(match[1]),count=0;
for(const key of Object.keys(map.imports))if(map.imports[key]==='/'+old){map.imports[key]='/'+next;count++;}assert(count);map.imports['/'+old]='/'+next;
html=html.replace(match[1],()=>JSON.stringify(map));write(root+'/web-payload/index.html',html);
write(root+'/web-changes.json',JSON.stringify([next,dialog,'index.html']));write(root+'/overlay-proof.json',JSON.stringify({apiFiles:4,webFiles:3,existingBytesPreserved:true}));console.log('API4/web3 prepared; root entry unchanged');

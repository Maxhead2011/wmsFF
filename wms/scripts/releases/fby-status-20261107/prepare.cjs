// FIX: overlay one reviewed API method and one FBY card in the captured runtime.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),previous=path.resolve(process.argv[3]);
const read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const parse=s=>ts.createSourceFile('runtime.js',s,99,true,ts.ScriptKind.JS);
const compile=(s,jsx=false)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:jsx?ts.ModuleKind.ESNext:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true,jsx:ts.JsxEmit.React}}).outputText;
const moduleName='modules/yandex-fby/yandex-fby.service.js';
let api=read(root+'/api-base/'+moduleName),next=compile(read('apps/api/src/modules/yandex-fby/yandex-fby.service.ts'));
function method(s){let found;const tree=parse(s);function visit(n){if(ts.isMethodDeclaration(n)&&n.name.getText(tree)==='refresh')found=n;ts.forEachChild(n,visit)}visit(tree);assert(found);return found;}
const old=method(api),fresh=method(next);api=api.slice(0,old.getStart())+fresh.getText()+api.slice(old.end);assert.equal(parse(api).parseDiagnostics.length,0);
write(root+'/api-payload/'+moduleName,api);write(root+'/api-changes.json',JSON.stringify([moduleName]));
const oldAsset='assets/ozon-errors-client-controls-20261107.js',newAsset='assets/fby-status-client-controls-20261107.js';
let web=read(previous+'/web-payload/'+oldAsset),tree=parse(web),callback;
function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(tree)==='he'&&n.arguments[0]?.getText(tree)==='()=>Ht(a,p,f.id)')callback=n.arguments[1];ts.forEachChild(n,visit)}visit(tree);assert(callback&&ts.isArrowFunction(callback));
web=web.slice(0,callback.getStart(tree))+`v=>{L(n=>n+1);${callback.body.getText(tree)};}`+web.slice(callback.end);
const start=web.indexOf('f.yandexFbyShipment.remoteNumber'),anchor='r("div",{className:"fby-actions",children:';
const pos=web.indexOf(anchor,start);assert(pos>start);
web=web.slice(0,pos)+'e(__FbyStatus,{status:f.yandexFbyShipment.remoteStatus,checkedAt:f.yandexFbyShipment.checkedAt}),'+web.slice(pos);
web='import {FbySupplyStatus as __FbyStatus} from "./fby-status-view-20261107.js";\n'+web;
assert.equal(parse(web).parseDiagnostics.length,0);write(root+'/web-payload/'+newAsset,web);
write(root+'/web-payload/assets/fby-status-view-20261107.js','import {r as React} from "./admin-tiles-20261019-0.js";\n'+compile(read('apps/web/src/components/yandex-fby/FbySupplyStatus.tsx'),true));
let html=read(previous+'/web-payload/index.html');const match=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(match[1]);let replaced=0;
for(const k of Object.keys(map.imports))if(map.imports[k]==='/'+oldAsset){map.imports[k]='/'+newAsset;replaced++;}assert(replaced);map.imports['/'+oldAsset]='/'+newAsset;
html=html.replace(match[1],()=>JSON.stringify(map));write(root+'/web-payload/index.html',html);
write(root+'/web-changes.json',JSON.stringify(['index.html',newAsset,'assets/fby-status-view-20261107.js']));
write(root+'/overlay-proof.json',JSON.stringify({apiMethods:['YandexFbyService.refresh'],apiFiles:1,webFiles:3,otherMethodsPreserved:true}));
console.log('Prepared API1/web3');

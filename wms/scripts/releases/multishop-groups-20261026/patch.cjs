// FIX: exact additions on the verified runtime, retaining all existing writers and routes.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),src=path.resolve(__dirname,'../../../apps/api/src'),websrc=path.resolve(__dirname,'../../../apps/web/src');
const opts={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true};
const compile=n=>ts.transpileModule(fs.readFileSync(src+'/'+n+'.ts','utf8'),{compilerOptions:opts}).outputText;
function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b);}
const changes=[];function write(n,s){assert.equal(ts.createSourceFile(n,s,99,true).parseDiagnostics.length,0);const p=root+'/api/'+n+'.js';fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);changes.push(n+'.js');}
const pre='modules/marketplace-connections/';
for(const name of ['multishop-stock-plan','multishop-stock-groups.service','multishop-stock-groups.controller'])write(pre+name,compile(pre+name));
let s=fs.readFileSync(root+'/api-base/'+pre+'marketplace-connections.module.js','utf8');
s='const multishop_service=require("./multishop-stock-groups.service");\nconst multishop_controller=require("./multishop-stock-groups.controller");\n'+s;
s=once(s,'controllers: [','controllers: [multishop_controller.MultishopStockGroupsController, ');
s=once(s,'providers: [','providers: [multishop_service.MultishopStockGroupsService, ');write(pre+'marketplace-connections.module',s);
const reg='modules/administration/administration-internal-api.service';s=fs.readFileSync(root+'/api-base/'+reg+'.js','utf8');
const start=s.indexOf("id: 'marketplace-connections'"),end=s.indexOf('description:',start);assert(start>0&&end>start);
let fragment=s.slice(start,end);fragment=once(fragment,"'/marketplace-connections/stock-confirmation']","'/marketplace-connections/stock-confirmation', '/marketplace-connections/multishop']");fragment=once(fragment,'routeCount: 135,','routeCount: 139,');
write(reg,s.slice(0,start)+fragment+s.slice(end));fs.writeFileSync(root+'/api-changes.json',JSON.stringify(changes));
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
(async()=>{
 const assets=root+'/web/assets';fs.mkdirSync(assets,{recursive:true});const ui='multishop-groups-ui-20261026.js',host='multishop-groups-host-20261026.js',old='fbs-seven-menu-20261024.js';
 const built=await esbuild.build({entryPoints:[websrc+'/components/fbs/MultishopStockGroupsEntry.tsx'],bundle:true,write:false,format:'esm',jsx:'automatic',minify:true,define:{'import.meta.env':'{}'},plugins:[{name:'host-react',setup(b){
   b.onResolve({filter:/^react(\/jsx-runtime)?$/},a=>({path:a.path,namespace:'host'}));
   b.onLoad({filter:/.*/,namespace:'host'},a=>({contents:a.path==='react'?'import{r as R}from"./admin-tiles-20261019-0.js";export const useState=(...a)=>R.useState(...a),useEffect=(...a)=>R.useEffect(...a),useRef=(...a)=>R.useRef(...a);':'import{j as J}from"./admin-tiles-20261019-0.js";export const jsx=(...a)=>J.jsx(...a),jsxs=(...a)=>J.jsxs(...a),Fragment=Symbol.for("react.fragment");',loader:'js',resolveDir:assets}));
   b.onResolve({filter:/admin-tiles-20261019-0\.js$/},a=>({path:a.path,external:true}));
 }}]});fs.writeFileSync(assets+'/'+ui,built.outputFiles[0].text);
 const original=fs.readFileSync(root+'/web-base/assets/'+old,'utf8');let patched=once(original,'title:"Между маркетплейсами",description:s','title:"Между магазинами",description:"Группы WB/Ozon и назначение товаров"');
 patched=once(patched,'d==="marketplaces"&&e.jsx(zl,{session:s,clientId:t},t)','d==="marketplaces"&&e.jsx(__Multishop.MultishopStockGroupsEntry,{session:s,clientId:t,fallback:e.jsx(zl,{session:s,clientId:t},t)},t)');
 patched='import * as __Multishop from "./'+ui+'";\n'+patched;assert.equal(ts.createSourceFile(host,patched,99,true).parseDiagnostics.length,0);fs.writeFileSync(assets+'/'+host,patched);
 fs.copyFileSync(websrc+'/components/fbs/multishop-stock-groups.css',assets+'/multishop-groups-20261026.css');
 let html=fs.readFileSync(root+'/web-base/index.html','utf8');const match=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(match);const map=JSON.parse(match[1]);
 for(const k of Object.keys(map.imports))if(map.imports[k]==='/assets/'+old)map.imports[k]='/assets/'+host;
 map.imports['/assets/'+old]='/assets/'+host;html=html.replace(match[1],JSON.stringify(map));html=html.replace('</head>','<link rel="stylesheet" href="/assets/multishop-groups-20261026.css">\n</head>');
 fs.writeFileSync(root+'/web/index.html',html);fs.writeFileSync(root+'/web-changes.json',JSON.stringify(['index.html','assets/'+ui,'assets/'+host,'assets/multishop-groups-20261026.css']));
 console.log('Prepared exact draft-only overlay: 5 API / 4 web files; publication worker excluded');
})().catch(e=>{console.error(e);process.exitCode=1});

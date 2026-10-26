// FIX: additive Lamoda overlay on the verified PR689 runtime; no old business module replacement.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),src=path.resolve(__dirname,'../../../apps/api/src'),websrc=path.resolve(__dirname,'../../../apps/web/src');
const opts={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true};
const compile=n=>ts.transpileModule(fs.readFileSync(src+'/'+n+'.ts','utf8'),{compilerOptions:opts}).outputText;
function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b);}
const changes=[];function write(n,s){assert.equal(ts.createSourceFile(n,s,99,true).parseDiagnostics.length,0);const p=root+'/api/'+n+'.js';fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);changes.push(n+'.js');}
for(const n of ['lamoda-client','lamoda-policy','lamoda.dto','lamoda.service','lamoda.controller','lamoda.module'])write('modules/lamoda/'+n,compile('modules/lamoda/'+n));
let s=fs.readFileSync(root+'/api-base/app.module.js','utf8');write('app.module',once(s,'imports: [','imports: [require("./modules/lamoda/lamoda.module").LamodaModule, '));
const cr='modules/client-requests/client-requests.module';s=fs.readFileSync(root+'/api-base/'+cr+'.js','utf8');assert(!s.includes('exports: ['));write(cr,once(s,'controllers: [','exports: [client_requests_service_1.ClientRequestsService],\n        controllers: ['));
const reg='modules/administration/administration-internal-api.service';s=fs.readFileSync(root+'/api-base/'+reg+'.js','utf8');
const regsrc=fs.readFileSync(src+'/'+reg+'.ts','utf8'),item=regsrc.slice(regsrc.indexOf('  // FIX: isolated, opt-in Lamoda'),regsrc.indexOf('  // FIX: scoped suspicious'));
assert(item.includes("id: 'lamoda'"));write(reg,once(s,'Object.freeze([','Object.freeze([\n'+item));fs.writeFileSync(root+'/api-changes.json',JSON.stringify(changes));
// Preserve every deployed model and scalar field. Only inverse relations and five new models are appended.
const old=fs.readFileSync(path.resolve(__dirname,'../../../baselines/our-wms/2026-10-26-multishop-groups/api-schema.prisma'),'utf8'),source=fs.readFileSync(path.resolve(__dirname,'../../../apps/api/prisma/schema.prisma'),'utf8');
let schema=old;for(const [model,field]of [['Client','lamodaAccounts LamodaAccount[]'],['Warehouse','lamodaPlans LamodaPlan[]'],['Sku','lamodaProducts LamodaProduct[]']])schema=once(schema,'model '+model+' {','model '+model+' {\n  '+field);
for(const name of ['Account','Product','Document','Plan','Exchange']){const m=source.match(new RegExp('model Lamoda'+name+' \\{[\\s\\S]*?\\n\\}'));assert(m);assert(!schema.includes('model Lamoda'+name));schema+='\n'+m[0]+'\n';}
fs.writeFileSync(root+'/schema.prisma',schema);fs.writeFileSync(root+'/schema-before.prisma',old);
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
(async()=>{
 const assets=root+'/web/assets';fs.mkdirSync(assets,{recursive:true});const ui='lamoda-ui-20261026.js',host='lamoda-fbo-host-20261026.js',old='admin-tiles-20261019-15.js';
 const built=await esbuild.build({entryPoints:[websrc+'/components/lamoda/LamodaPanel.tsx'],bundle:true,write:false,outfile:assets+'/'+ui,format:'esm',jsx:'automatic',minify:true,define:{'import.meta.env':'{}'},plugins:[{name:'host-react',setup(b){
  b.onResolve({filter:/^react(\/jsx-runtime)?$/},a=>({path:a.path,namespace:'host'}));b.onLoad({filter:/.*/,namespace:'host'},a=>({contents:a.path==='react'?'import{r as R}from"./admin-tiles-20261019-0.js";export const useState=(...a)=>R.useState(...a),useEffect=(...a)=>R.useEffect(...a);':'import{j as J}from"./admin-tiles-20261019-0.js";export const jsx=(...a)=>J.jsx(...a),jsxs=(...a)=>J.jsxs(...a),Fragment=Symbol.for("react.fragment");',loader:'js',resolveDir:assets}));b.onResolve({filter:/admin-tiles-20261019-0\.js$/},a=>({path:a.path,external:true}));
 }}]});for(const f of built.outputFiles)fs.writeFileSync(f.path,f.contents);
 let original=fs.readFileSync(root+'/web-base/assets/'+old,'utf8');
 original=once(original,'return e.jsxs("section"','const __lamoda=s.user.permissionCodes.some(p=>p==="system:admin"||p==="marketplace-api:read");return e.jsxs("section"');
 original=once(original,'e.jsx(r.Suspense,','__lamoda&&e.jsxs("button",{className:"fbs-marketplace-card","aria-pressed":a==="lamoda",onClick:()=>n("lamoda"),children:[e.jsx("strong",{children:"Lamoda"}),e.jsx("span",{children:"Подключение, каталог и подготовка FBO/FBS"})]}),e.jsx(r.Suspense,');
 original=once(original,'a==="ozon"?e.jsx(i,{session:s}):null','a==="ozon"?e.jsx(i,{session:s}):a==="lamoda"&&__lamoda?e.jsx(__Lamoda.LamodaPanel,{session:s}):null');
 original='import * as __Lamoda from "./'+ui+'";\n'+original;assert.equal(ts.createSourceFile(host,original,99,true).parseDiagnostics.length,0);fs.writeFileSync(assets+'/'+host,original);
 let html=fs.readFileSync(root+'/web-base/index.html','utf8');const match=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(match);const map=JSON.parse(match[1]);assert(!map.imports['/assets/'+old]);map.imports['/assets/'+old]='/assets/'+host;html=html.replace(match[1],JSON.stringify(map)).replace('</head>','<link rel="stylesheet" href="/assets/lamoda-ui-20261026.css">\n</head>');fs.writeFileSync(root+'/web/index.html',html);
 fs.writeFileSync(root+'/web-changes.json',JSON.stringify(['index.html','assets/'+ui,'assets/'+host,'assets/lamoda-ui-20261026.css']));
 console.log('Prepared Lamoda runtime, additive schema and FBO web overlay');
})().catch(e=>{console.error(e);process.exitCode=1});

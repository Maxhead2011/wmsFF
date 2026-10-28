// FIX: scoped overlay over the current verified Lamoda runtime, never a full source replacement.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),src=path.resolve(__dirname,'../../../apps/api/src'),websrc=path.resolve(__dirname,'../../../apps/web/src');
const opts={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true};
const compile=n=>ts.transpileModule(fs.readFileSync(src+'/'+n+'.ts','utf8'),{compilerOptions:opts}).outputText;
function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b);}
const changes=[];function write(n,s){assert.equal(ts.createSourceFile(n,s,99,true).parseDiagnostics.length,0);const p=root+'/api/'+n+'.js';fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);changes.push(n+'.js');}
const pre='modules/marketplace-connections/';
for(const name of ['plan','groups.service','groups.controller','publication','reservations','snapshot','reader','queue','transport','ownership','sync.service'])write(pre+'multishop-stock-'+name,compile(pre+'multishop-stock-'+name));
let s=fs.readFileSync(root+'/api-base/'+pre+'marketplace-connections.module.js','utf8');
s='const multishop_sync=require("./multishop-stock-sync.service");\n'+s;
s=once(s,'providers: [','providers: [multishop_sync.MultishopStockSyncService, ');write(pre+'marketplace-connections.module',s);
s=fs.readFileSync(root+'/api-base/'+pre+'marketplace-connections.service.js','utf8');
s='const multishop_ownership=require("./multishop-stock-ownership");\n'+s;
const start=s.indexOf('async putWildberriesStocksRaw('),end=s.indexOf('async openFbsCargoPacking(',start);assert(start>0&&end>start);
let fragment=s.slice(start,end);
fragment=once(fragment,'const assertCatalog = async () => {','const assertCatalog = async () => {\n await multishop_ownership.assertNotMultishopOwned(this.prisma,clientId,apiKey,stocks.map(s=>s.chrtId));');
s=s.slice(0,start)+fragment+s.slice(end);
s=once(s,'async fetchWildberriesFbsOrders(',`async readMultishopWildberriesOrders(connectionId,clientId) {
 const connection=await this.prisma.clientMarketplaceConnection.findFirstOrThrow({where:{id:connectionId,clientId,marketplace:'WILDBERRIES',isActive:true},include:{client:true}});
 return this.fetchWildberriesFbsOrders(connection,'full');
 }
 async fetchWildberriesFbsOrders(`);write(pre+'marketplace-connections.service',s);
const reg='modules/administration/administration-internal-api.service';s=fs.readFileSync(root+'/api-base/'+reg+'.js','utf8');
const rs=s.indexOf("id: 'marketplace-connections'"),re=s.indexOf('description:',rs);assert(rs>0&&re>rs);
write(reg,s.slice(0,rs)+once(s.slice(rs,re),'routeCount: 139,','routeCount: 143,')+s.slice(re));
fs.writeFileSync(root+'/api-changes.json',JSON.stringify(changes));
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
(async()=>{
 const assets=root+'/web/assets';fs.mkdirSync(assets,{recursive:true});const ui='multishop-auto-ui-20261026.js',host='multishop-auto-host-20261026.js',old='multishop-groups-host-20261026.js';
 const built=await esbuild.build({entryPoints:[websrc+'/components/fbs/MultishopStockGroupsEntry.tsx'],bundle:true,write:false,format:'esm',jsx:'automatic',minify:true,define:{'import.meta.env':'{}'},plugins:[{name:'host-react',setup(b){
   b.onResolve({filter:/^react(\/jsx-runtime)?$/},a=>({path:a.path,namespace:'host'}));
   b.onLoad({filter:/.*/,namespace:'host'},a=>({contents:a.path==='react'?'import{r as R}from"./admin-tiles-20261019-0.js";export const useState=(...a)=>R.useState(...a),useEffect=(...a)=>R.useEffect(...a),useRef=(...a)=>R.useRef(...a);':'import{j as J}from"./admin-tiles-20261019-0.js";export const jsx=(...a)=>J.jsx(...a),jsxs=(...a)=>J.jsxs(...a),Fragment=Symbol.for("react.fragment");',loader:'js',resolveDir:assets}));
   b.onResolve({filter:/admin-tiles-20261019-0\.js$/},a=>({path:a.path,external:true}));
 }}]});fs.writeFileSync(assets+'/'+ui,built.outputFiles[0].text);
 let html=fs.readFileSync(root+'/web-base/index.html','utf8');const match=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(match);const map=JSON.parse(match[1]);
 const actualHost=map.imports['/assets/'+old]||'/assets/'+old;
 assert(actualHost.startsWith('/assets/')&&!actualHost.includes('..'));
 const original=fs.readFileSync(root+'/web-base'+actualHost,'utf8');
 fs.writeFileSync(assets+'/'+host,once(original,'./multishop-groups-ui-20261026.js','./'+ui));
 for(const k of Object.keys(map.imports))if(map.imports[k]===actualHost)map.imports[k]='/assets/'+host;
 map.imports[actualHost]='/assets/'+host;
 map.imports['/assets/'+old]='/assets/'+host;html=html.replace(match[1],JSON.stringify(map));
 fs.writeFileSync(root+'/web/index.html',html);fs.writeFileSync(root+'/web-changes.json',JSON.stringify(['index.html','assets/'+ui,'assets/'+host]));
 console.log(JSON.stringify({api:changes.length,web:3}));
})().catch(e=>{console.error(e);process.exitCode=1});

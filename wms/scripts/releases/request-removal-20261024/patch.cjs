// FIX: additive delta over the fresh production runtime; no full-service replacement.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),src=path.resolve(__dirname,'../../../apps/api/src'),base=root+'/v2/api-base';
const opts={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true};
const read=n=>fs.readFileSync(base+'/'+n+'.js','utf8');
const changed=[];
function write(n,s){assert.equal(ts.createSourceFile('x.js',s,99,true).parseDiagnostics.length,0,n);const p=root+'/api/'+n+'.js';fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);changed.push(n+'.js');}
function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b);}
function method(s,name,fn){const a=ts.createSourceFile('x.js',s,99,true);let found=[];function visit(n){if(ts.isMethodDeclaration(n)&&n.name.getText(a)===name)found.push(n);ts.forEachChild(n,visit)}visit(a);assert.equal(found.length,1,name);const n=found[0];return s.slice(0,n.getStart(a))+fn(n.getText(a))+s.slice(n.end);}
const pre='modules/client-requests/';
for(const n of ['request-removal-policy','client-request-removal.service','client-request-removal.controller'])write(pre+n,ts.transpileModule(fs.readFileSync(src+'/'+pre+n+'.ts','utf8'),{compilerOptions:opts}).outputText);
let s=read(pre+'client-requests.module');s=once(s,'controllers: [','controllers: [require("./client-request-removal.controller").ClientRequestRemovalController,');s=once(s,'providers: [','providers: [require("./client-request-removal.service").ClientRequestRemovalService,');write(pre+'client-requests.module',s);
s=read(pre+'client-requests.service');s=method(s,'updateStatus',m=>{m=m.replace('{','{\n        await removal.assertRequestNotRemoved(this.prisma,id);\n');m=once(m,'const updated = await tx.clientRequest.update','await removal.lockRequestNotRemoved(tx,id);\n            const updated = await tx.clientRequest.update');return m;});write(pre+'client-requests.service','const removal=require("./request-removal-policy");\n'+s);
const market='modules/marketplace-connections/marketplace-connections.service';s=read(market);
s=method(s,'createFbsRequestUnlocked',m=>{m=once(m,'const clientId = dto.clientId.trim();','const clientId = dto.clientId.trim();\n        await removal.assertOrdersNotRemoved(this.prisma,clientId,dto.orders);');m=once(m,'const created = await tx.clientRequest.create','await removal.lockOrderLinks(tx,clientId,dto.orders);\n                await removal.assertOrdersNotRemoved(tx,clientId,dto.orders);\n                const created = await tx.clientRequest.create');return m;});
for(const name of ['syncFbsRequestsFromMarketplace','syncFbsPalletSortReservations'])s=method(s,name,m=>m.replace('{','{\n        orders=await removal.withoutRemovedOrders(this.prisma,clientId,orders);\n'));
s=method(s,'syncOneFbsRequest',m=>{m=once(m,'const existing = await tx.fbsOrderRequestLink.findUnique','await removal.lockOrderLinks(tx,clientId,[order]);\n                    const existing = await tx.fbsOrderRequestLink.findUnique');m=once(m,'if (existing &&','if(removal.requestRemovalEnabled() && existing?.syncStatus===removal.ADMIN_REMOVED)continue;\n                    if (existing &&');return m;});
s=method(s,'runAutoAssembly',m=>once(m,'const failures = response.connectionErrors;','response.orders=await removal.withoutRemovedOrders(this.prisma,clientId,response.orders);\n            const failures = response.connectionErrors;'));
write(market,'const removal=require("../client-requests/request-removal-policy");\n'+s);
const reg='modules/administration/administration-internal-api.service';s=read(reg);s=once(s,"prefixes: ['/client-requests',","prefixes: ['/client-request-removal', '/client-requests',");{const start=s.indexOf("id: 'client-requests'"),end=s.indexOf('description:',start);assert(start>0&&end>start);s=s.slice(0,start)+once(s.slice(start,end),'routeCount: 54,','routeCount: 57,')+s.slice(end);}write(reg,s);
fs.writeFileSync(root+'/api-changes.json',JSON.stringify(changed));
const webroot=root+'/web',assets=webroot+'/assets';fs.mkdirSync(assets,{recursive:true});
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
(async()=>{
 const built=await esbuild.build({entryPoints:[path.resolve(__dirname,'../../../apps/web/src/components/client-requests/RequestRemoval.tsx')],bundle:true,write:false,format:'esm',jsx:'automatic',minify:true,define:{'import.meta.env':'{}'},plugins:[{name:'host-react',setup(b){b.onResolve({filter:/^react(\/jsx-runtime)?$/},a=>({path:a.path,namespace:'host'}));b.onLoad({filter:/.*/,namespace:'host'},a=>({contents:a.path==='react'?'import{r as R}from"./admin-tiles-20261019-0.js";export const createContext=R.createContext,useContext=R.useContext,useState=R.useState,useEffect=R.useEffect,useRef=R.useRef;':'import{j as J}from"./admin-tiles-20261019-0.js";export const jsx=J.jsx,jsxs=J.jsxs,Fragment=J.Fragment;',loader:'js',resolveDir:assets}));b.onResolve({filter:/admin-tiles-20261019-0\.js$/},a=>({path:a.path,external:true}));}}]});
 const ui='request-removal-ui-20261024.js';fs.writeFileSync(assets+'/'+ui,built.outputFiles[0].text);
 const mapping={'history-refresh-20261022.js':'request-removal-requests-20261024.js','admin-tiles-20261019-14.js':'request-removal-ozon-20261024.js'};
 for(const [old,next]of Object.entries(mapping)){
  let web=fs.readFileSync(root+'/web-base/assets/'+old,'utf8');
  if(old.startsWith('history')){
   web=once(web,'className:"client-request-actions client-request-actions--main",children:[','className:"client-request-actions client-request-actions--main",children:[e.jsx(__Removal.RequestRemovalButton,{request:c}),');
   const a=ts.createSourceFile('x.js',web,99,true);let nodes=[];function visit(n){if(ts.isCallExpression(n)&&n.arguments[0]?.getText(a)==='__BatchFeatures.RequestZoneProvider')nodes.push(n);ts.forEachChild(n,visit)}visit(a);assert.equal(nodes.length,1);const n=nodes[0];web=web.slice(0,n.getStart(a))+'e.jsx(__Removal.RequestRemovalProvider,{token:t.accessToken,onRemoved:()=>void ke(),children:'+n.getText(a)+'})'+web.slice(n.end);
  }else{
   web=once(web,'t.createElement("div",{className:"ozfbo-workspace-actions"},','t.createElement("div",{className:"ozfbo-workspace-actions"},t.createElement(__Removal.RequestRemovalButton,{request:o}),');
   const a=ts.createSourceFile('x.js',web,99,true);let nodes=[];function visit(n){if(ts.isReturnStatement(n)&&n.expression?.getText(a).startsWith('t.createElement("section",{className:"ozfbo-shell ozfbo-customer-workspace"'))nodes.push(n);ts.forEachChild(n,visit)}visit(a);assert.equal(nodes.length,1);const n=nodes[0].expression;web=web.slice(0,n.getStart(a))+'t.createElement(__Removal.RequestRemovalProvider,{token:s.accessToken,onRemoved:x},'+n.getText(a)+')'+web.slice(n.end);
  }
  web='import * as __Removal from "./'+ui+'";\n'+web;assert.equal(ts.createSourceFile('x.js',web,99,true).parseDiagnostics.length,0);fs.writeFileSync(assets+'/'+next,web);
 }
 let html=fs.readFileSync(root+'/web-base/index.html','utf8');const match=html.match(/<script type="importmap">(.*?)<\/script>/);assert(match);const mp=JSON.parse(match[1]);
 for(const [old,next]of Object.entries(mapping)){for(const key of Object.keys(mp.imports))if(mp.imports[key]==='/assets/'+old)mp.imports[key]='/assets/'+next;mp.imports['/assets/'+old]='/assets/'+next;}
 html=html.replace(match[1],JSON.stringify(mp));fs.writeFileSync(webroot+'/index.html',html);fs.writeFileSync(root+'/web-changes.json',JSON.stringify(['index.html','assets/'+ui,...Object.values(mapping).map(n=>'assets/'+n)]));console.log('Patched request removal runtime and active web graph');
})().catch(e=>{console.error(e);process.exitCode=1});

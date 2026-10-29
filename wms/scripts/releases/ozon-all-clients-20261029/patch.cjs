// FIX: replace only list handlers and the workspace IIFE in the pinned production graph.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root=path.resolve(process.argv[2]),w=path.resolve(__dirname,'../../..');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const pins={
 'web-base/index.html':'2e7ad357f427a74de622428583da8c047df9ed3a1dd44581abe8d1245a897bca',
 'web-base/assets/workspace-ozon-20261028.js':'1b1500ace38712b6461794eda01dc053cc910dd27137169dad45e2cb65e35e04',
 'api-base/modules/client-requests/ozon-fbo-import.service.js':'e0d8ef5b57b828deb434d6471b60dbf419eaa11b383013c9fb4c8394f85949c2',
 'api-base/modules/client-requests/ozon-fbo-import.controller.js':'ebe944612ad7bdf5a1e7093110f38e1a901116da13ef16317e267abc8ec65755'};
for(const[n,h]of Object.entries(pins))assert.equal(sha(fs.readFileSync(root+'/'+n)),h,'Runtime base changed: '+n);
const ast=(s,n='runtime.js')=>ts.createSourceFile(n,s,99,true,n.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.JS);
function find(s,predicate){const a=ast(s),found=[];function visit(n){if(predicate(n,a))found.push(n);ts.forEachChild(n,visit)}visit(a);assert.equal(found.length,1);return{a,n:found[0]};}
function method(s,name){return find(s,(n,a)=>ts.isMethodDeclaration(n)&&n.name.getText(a)===name)}
function swap(s,old,next){return s.slice(0,old.n.getStart(old.a))+next+s.slice(old.n.end)}
function save(kind,n,s){if(n.endsWith('.js'))assert.equal(ast(s).parseDiagnostics.length,0,n);const p=root+'/'+kind+'/payload/'+n;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
const options={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true};
const sourceHashes={};function source(n){const b=fs.readFileSync(w+'/'+n);sourceHashes[n]=sha(b);return b.toString('utf8')}
for(const kind of ['service','controller']){
 const rel='modules/client-requests/ozon-fbo-import.'+kind;
 const compiled=ts.transpileModule(source('apps/api/src/'+rel+'.ts'),{compilerOptions:options}).outputText;
 const old=fs.readFileSync(root+'/api-base/'+rel+'.js','utf8');
 const m=method(compiled,'list');let next=m.n.getText(m.a);
 if(kind==='service'){
  assert(next.includes('ozon_supply_policy_1.supplyOrders'));next=next.replaceAll('ozon_supply_policy_1.supplyOrders','deadlinePolicy.supplyOrders');
  // No imports change: every runtime alias used by the transplanted method is already present.
  for(const alias of [...new Set(next.match(/\b\w+_\d+\./g)??[])])assert(old.includes('const '+alias.slice(0,-1)+' = require('),'Missing alias '+alias);
 }
 let changed=swap(old,method(old,'list'),next);
 if(kind==='controller'){
  const decorator=s=>find(s,(n,a)=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(a)==='__decorate'&&n.expression.arguments[2]?.getText(a)==='"list"');
  const d=decorator(compiled);changed=swap(changed,decorator(changed),d.n.getText(d.a));
 }
 save('api',rel+'.js',changed);
}
const withoutImports=(s,n)=>{const a=ast(s,n);return a.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(a)).join('\n')};
const apiSource=source('apps/web/src/lib/api.ts'),apiAst=ast(apiSource,'api.ts');
const requestFn=apiAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='fetchOzonCustomerRequests');assert(requestFn);
const helpers=`const React=e;const {useState,useEffect,useRef}=e;
 const useRememberedClientId=J,fetchFboPlan=Z,OzonAssemblySupply=M,OzonCustomerImport=__OzonImportLinks.OzonCustomerImport;
 const fetchWorkspaceClients=__MW.fetchWorkspaceClients,OzonEditCountdown=__Deadline.OzonEditCountdown;
 const RequestRemovalProvider=__Removal.RequestRemovalProvider,RequestRemovalButton=__Removal.RequestRemovalButton;
 async function request(url,{accessToken}){const response=await fetch('/api/v1'+url,{headers:{Authorization:'Bearer '+accessToken}});const value=await response.json();if(!response.ok)throw Error(Array.isArray(value.message)?value.message.join('; '):value.message??('HTTP '+response.status));return value;}
 `;
const contents=helpers+requestFn.getText(apiAst)+'\n'+withoutImports(source('apps/web/src/components/ozon-fbo/OzonAssemblyList.tsx'),'list.tsx')+'\n'+withoutImports(source('apps/web/src/components/ozon-fbo/OzonCustomerWorkspace.tsx'),'workspace.tsx');
const replacement=esbuild.buildSync({stdin:{contents,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__OzonWarehouse',minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;
let html=fs.readFileSync(root+'/web-base/index.html','utf8'),match=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(match);
const map=JSON.parse(match[1]),oldPath=map.imports['/assets/admin-tiles-20261019-14.js'];assert.equal(oldPath,'/assets/workspace-ozon-20261028.js');
const host=fs.readFileSync(root+'/web-base'+oldPath,'utf8');
const oldNode=find(host,(n,a)=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(a)==='__OzonWarehouse'));
const changedHost=swap(host,oldNode,replacement);
const name='ozon-all-clients-20261029';save('web','assets/'+name+'.js',changedHost);
const css=source('apps/web/src/components/ozon-fbo/ozon-assembly-list.css');save('web','assets/'+name+'.css',css);
for(const k of Object.keys(map.imports))if(map.imports[k]===oldPath)map.imports[k]='/assets/'+name+'.js';map.imports[oldPath]='/assets/'+name+'.js';
html=html.replace(match[1],JSON.stringify(map));assert.equal(html.split('</head>').length,2);html=html.replace('</head>','<link rel="stylesheet" href="/assets/'+name+'.css"></head>');save('web','index.html',html);
fs.writeFileSync(root+'/patch-proof.json',JSON.stringify({baseHashes:pins,sourceHashes,apiMethods:['OzonFboImportService.list','OzonFboImportController.list','OzonFboImportController.list decorators'],webReplacement:'__OzonWarehouse',sharedFboUnchanged:true,ozonSupplyUnchanged:true,ozonImportUnchanged:true},null,2));
console.log('Pinned runtime patched: 2 API files, 3 web files; shared FBO, cargo and import retained.');

// FIX: replace only the two reviewed workspace functions in the current deployed chunk.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),source=path.resolve('apps/web/src/components/ozon-fbo');
const old='/assets/ipv4-ui-ozon-stock-20261102.js',next='/assets/ozon-inbound-composition-20261107.js';
let html=fs.readFileSync(path.join(root,'web-base/index.html'),'utf8'),text=fs.readFileSync(path.join(root,'web-base',old),'utf8');
const marker='var __OzonWarehouse=(()=>{',start=text.indexOf(marker);assert(start>0);
const ast=ts.createSourceFile('live.js',text,99,true,ts.ScriptKind.JS),functions=[];
function visit(n){if(ts.isFunctionDeclaration(n)&&n.pos>start&&['le','Ee'].includes(n.name?.text))functions.push(n);ts.forEachChild(n,visit)}visit(ast);assert.equal(functions.length,2);
function compile(name){let s=fs.readFileSync(path.join(source,name+'.tsx'),'utf8');const a=ts.createSourceFile(name+'.tsx',s,99,true,ts.ScriptKind.TSX);for(const n of [...a.statements].reverse())if(ts.isImportDeclaration(n))s=s.slice(0,n.pos)+s.slice(n.end);s=s.replace('export function '+name,'function '+name);
 if(name==='OzonCustomerWorkspace'){assert(s.includes("['wms.logoff.pro','localhost','127.0.0.1']"));s=s.replace("['wms.logoff.pro','localhost','127.0.0.1']","['wms.logoff.pro','localhost','127.0.0.1','77.37.144.211','192.168.0.45']");}
 return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React,jsxFactory:'o.createElement',jsxFragmentFactory:'o.Fragment'}}).outputText.replace(/export\s*\{\s*\};?/g,'');}
const bridge=`const __Inbound=(()=>{const useState=u,useEffect=P,useRef=L,useRememberedClientId=ye,fetchFboPlan=ze,fetchOzonCustomerRequests=G,fetchWorkspaceClients=we,OzonAssemblySupply=ne,OzonCustomerImport=Ne,OzonEditCountdown=V,RequestRemovalProvider=Oe,RequestRemovalButton=se,FboWorkspaceModal=ie,OzonStoreLabel=(props)=>__FboStore.OzonStoreLabel(props);
 async function ozonSync(accessToken,id,action,body={}){const response=await fetch('/api/v1/tsd/requests/'+encodeURIComponent(id)+'/fbo/ozon-adjustment/'+action,{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(Array.isArray(data.message)?data.message.join('; '):data.message??'HTTP '+response.status);return data;}
 ${['OzonCompositionSync','OzonAssemblyList','OzonCustomerWorkspace'].map(compile).join('\n')}
 return {OzonAssemblyList,OzonCustomerWorkspace};})();`;
const ranges=functions.map(n=>({start:n.getStart(ast),end:n.end,name:n.name.text}));
for(const n of [...ranges].reverse())text=text.slice(0,n.start)+`function ${n.name}(props){return __Inbound.${n.name==='le'?'OzonAssemblyList':'OzonCustomerWorkspace'}(props);}`+text.slice(n.end);
text=text.replace('function le(props){',()=>bridge+'function le(props){');
assert.equal(ts.createSourceFile('patched.js',text,99,true,ts.ScriptKind.JS).parseDiagnostics.length,0);
const mapMatch=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(mapMatch[1]);let count=0;
for(const key of Object.keys(map.imports))if(map.imports[key]===old){map.imports[key]=next;count++;}assert(count>=10);map.imports[old]=next;
html=html.replace(mapMatch[1],()=>JSON.stringify(map)).replace('</head>','<link rel="stylesheet" href="/assets/ozon-inbound-composition-20261107.css">\n</head>');
fs.mkdirSync(path.join(root,'web-payload/assets'),{recursive:true});fs.writeFileSync(path.join(root,'web-payload',next),text);
fs.writeFileSync(path.join(root,'web-payload/assets/ozon-inbound-composition-20261107.css'),fs.readFileSync(path.join(source,'ozon-composition-sync.css')));
fs.writeFileSync(path.join(root,'web-payload/index.html'),html);
fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(['index.html',next.slice(1),'assets/ozon-inbound-composition-20261107.css']));
fs.writeFileSync(path.join(root,'overlay-proof.json'),JSON.stringify({functions:ranges.map(n=>n.name),importMappings:count,apiChanged:false,ipv4HostsPreserved:true}));
console.log('Prepared exact function overlay; existing imports, API helpers, supply/import modules and IPv4 gate preserved');

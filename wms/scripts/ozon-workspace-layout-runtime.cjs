// FIX: preserve the live graph; replace only the four approved Ozon UI components.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('./single-react-graph.cjs');const root=process.argv[2],w=path.resolve(__dirname,'..');
const input=path.join(root,'web-base'),output=path.join(root,'web'),cache={};
const files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
const read=n=>{const s=fs.readFileSync(path.join(w,'apps/web/src',n),'utf8'),sf=ts.createSourceFile(n,s,99,true,ts.ScriptKind.TSX);return sf.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(sf)).join('\n');};
const hooks='const React=e;const {useState,useEffect,useRef}=e;';
const request=`async function api(path,token,body){const r=await fetch('/api/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(Array.isArray(v.message)?v.message.join('; '):v.message??('HTTP '+r.status));return v;}`;
const imports=hooks+request+`
const ozonCustomerImportEnabled=t=>api('ozon-fbo-import/capability',t);
const fetchOzonCustomerWarehouses=(t,c)=>api('ozon-fbo-import/warehouses?clientId='+encodeURIComponent(c),t);
function form(p){const f=new FormData();for(const [k,v] of Object.entries(p))if(v!==undefined&&v!==null&&v!=='')f.append(k,v);return f;}
const previewOzonCustomerFile=(t,p)=>api('ozon-fbo-import/preview',t,form(p)),createOzonCustomerFile=(t,p)=>api('ozon-fbo-import/commit',t,form(p));
const fetchOzonLinkConnections=(t,c)=>api('ozon-fbo-import/link-connections?clientId='+encodeURIComponent(c),t),previewOzonLinks=(t,b)=>api('ozon-fbo-import/links/preview',t,b),createOzonLinks=(t,b)=>api('ozon-fbo-import/links/commit',t,b);`;
const workspace=hooks+request+`const fetchClients=K,useRememberedClientId=J,fetchFboPlan=Z,OzonAssemblySupply=M,OzonCustomerImport=__OzonImportLinks.OzonCustomerImport;
const fetchOzonCustomerRequests=(t,c,w,v='active')=>api('ozon-fbo-import/requests?clientId='+encodeURIComponent(c)+(w?'&warehouseId='+encodeURIComponent(w):'')+'&view='+v,t);`;
const supply=hooks+'const ozonAssemblySupply=A,downloadOzonCargoMapping=ee,ozonCabinetLabel=__OzonImportLinks.ozonCabinetLabel;';
function bundle(code,name){return esbuild.buildSync({stdin:{contents:code,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:name,minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;}
let counts={imports:0,workspace:0,supply:0};
for(const n of fs.readdirSync(path.join(input,'assets')).filter(n=>n.endsWith('.js'))){let s=files['assets/'+n];if(!s.includes('__OzonImportLinks'))continue;
 const sf=ts.createSourceFile(n,s,99,true),edits=[];function visit(node){
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(sf)==='__OzonImportLinks')){edits.push({start:node.getStart(sf),end:node.end,code:bundle(imports+read('components/client-requests/OzonLinkImport.tsx')+read('components/client-requests/OzonCustomerImport.tsx'),'__OzonImportLinks')});counts.imports++;return;}
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(sf)==='__OzonWarehouse')){assert(node.getText(sf).includes('=K')&&node.getText(sf).includes('=J'),'Workspace binding drift');edits.push({start:node.getStart(sf),end:node.end,code:bundle(workspace+read('components/ozon-fbo/OzonCustomerWorkspace.tsx'),'__OzonWarehouse')});counts.workspace++;return;}
  if(ts.isFunctionDeclaration(node)&&node.name?.text==='M'&&node.getText(sf).includes('cargo-mapping')===false&&node.getText(sf).includes('requestId:')&&node.getText(sf).includes('frozenHash')){edits.push({start:node.getStart(sf),end:node.end,code:bundle(supply+read('components/ozon-fbo/OzonAssemblySupply.tsx'),'__OzonSupplyLayout')+'function M(props){return __OzonSupplyLayout.OzonAssemblySupply(props)}'});counts.supply++;return;}
  ts.forEachChild(node,visit);
 }visit(sf);for(const edit of edits.sort((a,b)=>b.start-a.start))s=s.slice(0,edit.start)+edit.code+s.slice(edit.end);cache['assets/'+n]=s;
}
assert.deepEqual(counts,{imports:2,workspace:1,supply:1});
const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];
const result=repair(files,entry,entry,'ozon-layout-20261014');
result['index.html']=result['index.html'].replace('</head>','<link rel="stylesheet" href="/assets/ozon-workspace-layout-20261014.css"></head>');
result['assets/ozon-workspace-layout-20261014.css']=fs.readFileSync(path.join(w,'apps/web/src/components/ozon-fbo/ozon-workspace.css'),'utf8');
for(const[n,data]of Object.entries(result)){if(n.endsWith('.js'))assert.equal(ts.createSourceFile(n,data,99,true).parseDiagnostics.length,0,n);const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(Object.keys(result)));console.log(JSON.stringify({...counts,web:Object.keys(result).length}));

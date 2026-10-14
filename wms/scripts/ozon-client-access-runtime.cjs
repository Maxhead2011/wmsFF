// FIX: overlay only source-parity Ozon API modules and import/workspace functions in the pinned web graph.
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),ts=require('../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('./single-react-graph.cjs');const root=process.argv[2],w=path.resolve(__dirname,'..');
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
const names=['ozon-link-import.service'],changed=[];
for(const n of names){const rel='wms/apps/api/src/modules/client-requests/'+n+'.ts',dest=path.join(root,'current/api/modules/client-requests/'+n+'.js');
 if(!n.startsWith('dto/')){const old=compile(cp.execFileSync('git',['show','f8d7e35b:'+rel],{cwd:path.dirname(w),encoding:'utf8'})),actual=fs.readFileSync(dest,'utf8');assert.equal(old.replace(/\r/g,''),actual.replace(/\r/g,''),'Runtime parity required: '+n);}
 fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,compile(fs.readFileSync(path.join(path.dirname(w),rel),'utf8')));changed.push('modules/client-requests/'+n+'.js');}
const input=path.join(root,'web-base'),output=path.join(root,'web'),cache={};const files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
const read=n=>{const s=fs.readFileSync(path.join(w,'apps/web/src',n),'utf8'),sf=ts.createSourceFile(n,s,99,true,ts.ScriptKind.TSX);return sf.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(sf)).join('\n');};
const helpers=`const React=e;const {useState,useEffect,useRef}=e;
async function api(path,token,body){const r=await fetch('/api/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(Array.isArray(v.message)?v.message.join('; '):v.message??('HTTP '+r.status));return v;}
const ozonCustomerImportEnabled=t=>api('ozon-fbo-import/capability',t);
const fetchOzonCustomerWarehouses=(t,c)=>api('ozon-fbo-import/warehouses?clientId='+encodeURIComponent(c),t);
const fetchOzonCustomerRequests=(t,c,w)=>api('ozon-fbo-import/requests?clientId='+encodeURIComponent(c)+(w?'&warehouseId='+encodeURIComponent(w):''),t);
function form(p){const f=new FormData();for(const [k,v] of Object.entries(p))if(v!==undefined&&v!==null&&v!=='')f.append(k,v);return f;}
const previewOzonCustomerFile=(t,p)=>api('ozon-fbo-import/preview',t,form(p)),createOzonCustomerFile=(t,p)=>api('ozon-fbo-import/commit',t,form(p));
const fetchOzonLinkConnections=(t,c)=>api('ozon-fbo-import/link-connections?clientId='+encodeURIComponent(c),t),previewOzonLinks=(t,b)=>api('ozon-fbo-import/links/preview',t,b),createOzonLinks=(t,b)=>api('ozon-fbo-import/links/commit',t,b);`;
function bundle(code,name){return esbuild.buildSync({stdin:{contents:code,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:name,minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;}
let imports=0,workspaces=0;
for(const n of fs.readdirSync(path.join(input,'assets')).filter(n=>n.endsWith('.js'))){let s=files['assets/'+n];if(!s.includes('__OzonImportLinks'))continue;
 const sf=ts.createSourceFile(n,s,99,true,ts.ScriptKind.JS),edits=[],nodes=[];function visit(node){nodes.push(node);ts.forEachChild(node,visit);}visit(sf);for(const node of nodes){if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(sf)==='__OzonImportLinks')){edits.push({start:node.getStart(sf),end:node.end,code:bundle(helpers+read('components/client-requests/OzonLinkImport.tsx')+read('components/client-requests/OzonCustomerImport.tsx'),'__OzonImportLinks')});imports++;}}
 for(const edit of edits.sort((a,b)=>b.start-a.start))s=s.slice(0,edit.start)+edit.code+s.slice(edit.end);cache['assets/'+n]=s;
}assert.equal(imports,2);
const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1],result=repair(files,entry,'kiz-physical-20261013-15.js','ozon-client-access-20261014');
for(const[n,data]of Object.entries(result)){if(n.endsWith('.js'))assert.equal(ts.createSourceFile(n,data,99,true,ts.ScriptKind.JS).parseDiagnostics.length,0,n);const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
fs.writeFileSync(path.join(root,'api-changes.json'),JSON.stringify(changed));fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(Object.keys(result)));console.log(JSON.stringify({imports,workspaces,api:changed.length,web:Object.keys(result).length}));

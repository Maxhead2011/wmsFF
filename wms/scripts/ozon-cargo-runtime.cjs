// FIX: exact runtime delta from the verified live base, not a full source build.
const fs=require('fs'),path=require('path'),ts=require('../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('./single-react-graph.cjs');
const root=process.argv[2],input=path.join(root,'web-base'),output=path.join(root,'web'),changed=[];
function edit(n,fn){const p=path.join(root,'api',n);fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));changed.push(n);}
function once(s,a,b){if(s.split(a).length!==2)throw Error('Exact anchor failed: '+a);return s.replace(a,b);}
const cp=require('child_process'),assert=require('assert/strict');
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
for(const n of ['ozon-assembly-supply.service','ozon-assembly-supply.controller']){
 const rel='wms/apps/api/src/modules/client-requests/'+n+'.ts',file='modules/client-requests/'+n+'.js';
 const old=cp.execFileSync('git',['show','164a0a79:'+rel],{encoding:'utf8'});
 assert.equal(fs.readFileSync(path.join(root,'api',file),'utf8').replace(/\r/g,''),compile(old).replace(/\r/g,''),'Runtime drift '+n);
 fs.writeFileSync(path.join(root,'api',file),compile(fs.readFileSync(path.join(__dirname,'../apps/api/src/modules/client-requests/'+n+'.ts'),'utf8')));changed.push(file);
}
const file='modules/client-requests/ozon-cargo-export.js';
fs.writeFileSync(path.join(root,'api',file),ts.transpileModule(fs.readFileSync(path.join(__dirname,'../apps/api/src/modules/client-requests/ozon-cargo-export.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);changed.push(file);
edit('modules/administration/administration-internal-api.service.js',s=>{
 const re=/(prefixes: \['\/client-requests', '\/ozon-fbo-import', '\/ozon-fbo-import\/requests\/:id\/supply'\],[\s\S]{0,100}routeCount: )49/;
 assert.ok(re.test(s),'registry drift');return s.replace(re,'$150');
});
const cache={},files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];
const ozon=fs.readdirSync(path.join(input,'assets')).find(n=>n.endsWith('.js')&&files['assets/'+n].includes('var __OzonEntry='));if(!ozon)throw Error('Entry missing');
let s=files['assets/'+ozon];
const read=n=>fs.readFileSync(path.join(__dirname,'../apps/web/src/',n),'utf8').replace(/^import .*;\r?\n/gm,'');
const helpers=`const React=h;const {useState,useEffect,useRef}=h;const useRememberedClientId=Ye,fetchClients=Ge;
 async function api(path,token,body){const r=await fetch('/api/v1'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token},body});if(!r.ok){let e;try{e=await r.json()}catch{}throw Error(e?.message??('HTTP '+r.status));}return r.json();}
 const ozonCustomerImportEnabled=t=>api('/ozon-fbo-import/capability',t),fetchOzonCustomerRequests=(t,c)=>api('/ozon-fbo-import/requests?clientId='+encodeURIComponent(c),t),fetchFboPlan=(t,id)=>api('/tsd/requests/'+encodeURIComponent(id)+'/fbo',t);
 function submit(t,p,kind){const f=new FormData();for(const[k,v]of Object.entries(p))if(v!==undefined&&v!=='')f.append(k,v);return api('/ozon-fbo-import/'+kind,t,f);}
 const previewOzonCustomerFile=(t,p)=>submit(t,p,'preview'),createOzonCustomerFile=(t,p)=>submit(t,p,'commit');`;

const linkApi=`async function ozonAssemblySupply(t,id,a,body={}){const r=await fetch('/api/v1/ozon-fbo-import/requests/'+encodeURIComponent(id)+'/supply'+(a?'/'+a:''),{method:a?'POST':'GET',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},...(a?{body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(v.message??('HTTP '+r.status));return v;}`;
const downloadApi=`async function downloadOzonCargoMapping(t,id){const r=await fetch('/api/v1/ozon-fbo-import/requests/'+encodeURIComponent(id)+'/supply/cargo-mapping.xlsx',{headers:{Authorization:'Bearer '+t}});if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.message??('HTTP '+r.status));}return r.blob();}`;
const code=helpers+linkApi+downloadApi+read('components/client-requests/OzonCustomerImport.tsx')+read('components/ozon-fbo/OzonAssemblySupply.tsx')+read('components/ozon-fbo/OzonCustomerWorkspace.tsx');
const start=s.indexOf('var __OzonEntry='),end=s.indexOf('\nfunction OzonEntry',start);if(start<0||end<0)throw Error('Wrapper anchors');
s=s.slice(0,start)+esbuild.buildSync({stdin:{contents:code,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__OzonEntry',minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text+s.slice(end);
cache['assets/'+ozon]=s;const result=repair(files,entry,entry,'ozon-cargo-20261010');
for(const[n,data]of Object.entries(result)){const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(Object.keys(result)));fs.writeFileSync(path.join(root,'api-changes.json'),JSON.stringify(changed));
console.log(JSON.stringify({api:changed,web:Object.keys(result).length}));

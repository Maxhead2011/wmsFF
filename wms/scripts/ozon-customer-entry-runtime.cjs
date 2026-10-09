// FIX: add the customer-file mode to the actual deployed Ozon entry, retaining the legacy API flow.
const fs=require('fs'),path=require('path'),ts=require('../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('./single-react-graph.cjs');
const root=process.argv[2],input=path.join(root,'web-base'),output=path.join(root,'web');
const changed=[];
for(const n of ['modules/client-requests/ozon-fbo-import.service','modules/client-requests/ozon-fbo-import.controller']){
 const source=fs.readFileSync(path.join(__dirname,'../apps/api/src',n+'.ts'),'utf8');
 fs.writeFileSync(path.join(root,'api',n+'.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText);changed.push(n+'.js');
}
const registry='modules/administration/administration-internal-api.service.js',rp=path.join(root,'api',registry);let rs=fs.readFileSync(rp,'utf8');
const re=/(prefixes: \['\/client-requests', '\/ozon-fbo-import'\],[\s\S]{0,100}routeCount: )41/;
if(!re.test(rs))throw Error('registry anchor');fs.writeFileSync(rp,rs.replace(re,'$142'));changed.push(registry);
const cache={},files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];
const names=fs.readdirSync(path.join(input,'assets')).filter(n=>n.endsWith('.js'));
const ozon=names.find(n=>files['assets/'+n].includes('Поставки FBO без ручной рутины'));
const requests=names.find(n=>files['assets/'+n].includes('function LegacyWbBi('));if(!ozon||!requests)throw Error('Missing deployed panels');
let s=files['assets/'+ozon];if(s.split('export{Es as OzonFboPanel};').length!==2)throw Error('Ozon export guard');
s=s.replace('export{Es as OzonFboPanel};','export{OzonEntry as OzonFboPanel};');
cache['assets/'+requests]=files['assets/'+requests]+'\nexport{Bi as CustomerAssemblyPanel};\n';
s+='\nimport {CustomerAssemblyPanel as FboTwoStagePanel} from "./'+requests+'";\n';
const read=n=>fs.readFileSync(path.join(__dirname,'../apps/web/src/',n),'utf8').replace(/^import .*;\r?\n/gm,'');
const helpers=`const React=h;const {useState,useEffect,useRef}=h;const useRememberedClientId=Ye,fetchClients=Ge;
 async function api(path,token,body){const r=await fetch('/api/v1'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token},body});if(!r.ok){let e;try{e=await r.json()}catch{}throw Error(e?.message??('HTTP '+r.status));}return r.json();}
 const ozonCustomerImportEnabled=t=>api('/ozon-fbo-import/capability',t),fetchOzonCustomerRequests=(t,c)=>api('/ozon-fbo-import/requests?clientId='+encodeURIComponent(c),t),fetchFboPlan=(t,id)=>api('/tsd/requests/'+encodeURIComponent(id)+'/fbo',t);
 function submit(t,p,kind){const f=new FormData();for(const[k,v]of Object.entries(p))if(v!==undefined&&v!=='')f.append(k,v);return api('/ozon-fbo-import/'+kind,t,f);}
 const previewOzonCustomerFile=(t,p)=>submit(t,p,'preview'),createOzonCustomerFile=(t,p)=>submit(t,p,'commit');`;
const code=helpers+read('components/client-requests/OzonCustomerImport.tsx')+read('components/ozon-fbo/OzonCustomerWorkspace.tsx');
s+='\n'+esbuild.buildSync({stdin:{contents:code,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__OzonEntry',minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;
s+=`\nfunction OzonEntry({session}){const[enabled,setEnabled]=h.useState(null),[legacy,setLegacy]=h.useState(false);h.useEffect(()=>{let live=true;fetch('/api/v1/ozon-fbo-import/capability',{headers:{Authorization:'Bearer '+session.accessToken}}).then(r=>r.ok?r.json():{enabled:false}).then(r=>{if(live)setEnabled(r.enabled)}).catch(()=>{if(live)setEnabled(false)});return()=>{live=false}},[session.accessToken]);if(enabled===null)return e.jsx('p',{role:'status',children:'Загружаю режимы FBO Ozon…'});if(!enabled)return e.jsx(Es,{session});return e.jsxs(e.Fragment,{children:[e.jsxs('div',{role:'group','aria-label':'Режим FBO Ozon',style:{display:'flex',gap:12,marginBottom:16},children:[e.jsx('button',{type:'button','aria-pressed':!legacy,onClick:()=>setLegacy(false),children:'Файл клиента — единая сборка'}),e.jsx('button',{type:'button','aria-pressed':legacy,onClick:()=>setLegacy(true),children:'План через API Ozon'})]}),e.jsx(legacy?Es:__OzonEntry.OzonCustomerWorkspace,{session})]})}\n`;
cache['assets/'+ozon]=s;const result=repair(files,entry,entry,'ozon-entry-20261009');
for(const[n,data]of Object.entries(result)){const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(Object.keys(result)));fs.writeFileSync(path.join(root,'api-changes.json'),JSON.stringify(changed));
console.log(JSON.stringify({api:changed,web:Object.keys(result).length}));

// FIX: preserve the published WB panel and React owner; add Ozon-only UI.
const fs=require('fs'),path=require('path'),esbuild=require('module').createRequire(require.resolve('../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('./single-react-graph.cjs');
function build(input,output){
 const cache={},files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
 const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];
 const panel='assets/menu-reads-20261009-29.js';let s=files[panel];
 function replace(a,b){if(s.split(a).length!==2)throw Error('web guard '+a);s=s.replace(a,b);}
 replace('function Bi({initial:s,accessToken:t,userId:d,canWrite:r,onClose:u})','function LegacyWbBi({initial:s,accessToken:t,userId:d,canWrite:r,onClose:u})');
 replace('e.jsx("summary",{children:"Сборка из Excel"}),e.jsx(ni,','e.jsx(__Ozon.OzonCustomerImport,{clients:Gs,session:t,onCreated:()=>void ke()}),e.jsx("summary",{children:"Сборка из Excel"}),e.jsx(ni,');
 const read=n=>fs.readFileSync(path.join(__dirname,'../apps/web/src/',n),'utf8').replace(/^import .*;\r?\n/gm,'');
 const helpers=`const React=o;const {useState,useEffect,useRef}=o;const FboProgress=Ii,startFboPolling=Ci,fetchFboPlan=$a,actFbo=Oa,downloadFboWbFile=Ma;
 async function api(path,token,body){const r=await fetch('/api/v1'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token},body});if(!r.ok){let e;try{e=await r.json()}catch{}throw Error(e?.message??('HTTP '+r.status));}return r.json();}
 const ozonCustomerImportEnabled=t=>api('/ozon-fbo-import/capability',t);
 function submit(t,p,kind){const f=new FormData();for(const[k,v]of Object.entries(p))if(v!==undefined&&v!=='')f.append(k,v);return api('/ozon-fbo-import/'+kind,t,f);}
 const previewOzonCustomerFile=(t,p)=>submit(t,p,'preview'),createOzonCustomerFile=(t,p)=>submit(t,p,'commit');`;
 const code=helpers+read('lib/assemblyProductDisplay.ts')+read('components/client-requests/FboTwoStagePanel.tsx')+read('components/client-requests/OzonCustomerImport.tsx');
 s+='\n'+esbuild.buildSync({stdin:{contents:code,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__Ozon',minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;
 s+='\nfunction Bi(props){return e.jsx(props.initial.marketplace==="OZON"?__Ozon.FboTwoStagePanel:LegacyWbBi,props);}\n';
 cache[panel]=s;const result=repair(files,entry,entry,'ozon-customer-20261009');
 for(const[n,data]of Object.entries(result)){const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
 fs.writeFileSync(path.join(output,'../web-changes.json'),JSON.stringify(Object.keys(result)));return Object.keys(result);
}
module.exports={build};if(require.main===module)console.log(JSON.stringify(build(...process.argv.slice(2))));

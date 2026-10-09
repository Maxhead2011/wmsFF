// FIX: reuse the deployed React owner and FBO recovery component; retain all other runtime screens.
const fs=require('fs'),path=require('path'),esbuild=require('module').createRequire(require.resolve('../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('./single-react-graph.cjs');
function build(input,output){
 const cache={},files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
 const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])?.[1];if(!entry)throw Error('Entry missing');
 const all=fs.readdirSync(path.join(input,'assets')).filter(n=>n.endsWith('.js'));
 const admin=all.filter(n=>files['assets/'+n].includes('as AdministrationPanel'));if(admin.length!==1)throw Error('Admin guard');const name='assets/'+admin[0];let s=files[name];
 function one(s,a,b){if(s.split(a).length!==2)throw Error('Web guard '+a);return s.replace(a,b);}
 if(!s.includes('function ut({session:s})')||!s.includes('r as a'))throw Error('React/FBO owner guard');
 const strip=n=>fs.readFileSync(path.join(__dirname,'../apps/web/src/components/administration/'+n),'utf8').replace(/^import .*;\r?\n/gm,'');
 const helpers=`const React=a;const {useState,useEffect,useRef}=a;const AdministrationFboProblems=ut;const fetchFboRecoveryCapabilities=Sn;
 async function request(token,url,body){const r=await fetch('/api/v1'+url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(Array.isArray(data.message)?data.message.join('; '):data.message||'Ошибка сервера');return data;}
 const fetchReceiptBarcodeSummary=t=>request(t,'/tsd/receipt-barcode-review/summary');
 const fetchReceiptBarcodeProblems=t=>request(t,'/tsd/receipt-barcode-review');
 const resolveReceiptBarcodeProblem=(t,id,body)=>request(t,'/tsd/receipt-barcode-review/'+encodeURIComponent(id)+'/resolve',body);
 `;
 const wrapper=`export function Panel(props){const [open,setOpen]=useState(false);if(!canUseOperationalProblems(props.session))return React.createElement(Bt,props);if(!props.session.user.administrationEnabled)return React.createElement(OperationalProblemsPanel,{session:props.session});return <><button className="admin-button" onClick={()=>setOpen(!open)}>{open?'Назад к администрированию':'Проблемы приёмки и ФБО'}</button>{open?<OperationalProblemsPanel session={props.session}/>:<Bt {...props}/>}</>;}`;
 s+='\n'+esbuild.buildSync({stdin:{contents:helpers+strip('ReceiptBarcodeProblems.tsx')+strip('OperationalProblemsPanel.tsx')+wrapper,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__ReceiptProblems',minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;
 s=one(s,'Bt as AdministrationPanel','__ReceiptProblemsPanel as AdministrationPanel');s+='\nfunction __ReceiptProblemsPanel(props){return a.createElement(__ReceiptProblems.Panel,props);}\n';cache[name]=s;
 const owner=all.filter(n=>files['assets/'+n].includes('function a2(t,n){var s;return n.id==='));if(owner.length!==1)throw Error('Menu guard');const op='assets/'+owner[0];cache[op]=one(files[op],'function a2(t,n){var s;return','function a2(t,n){if(n.id==="administration"&&!t.isDemo&&t.roleCodes.some(r=>r==="ADMIN"||r==="OWNER")&&t.permissionCodes.includes("stock:write"))return true;var s;return');
 const result=repair(files,entry,entry,'receipt-review-20261009');
 result['assets/receipt-review-20261009.css']=fs.readFileSync(path.join(__dirname,'../apps/web/src/components/administration/receipt-barcode-problems.css'),'utf8');
 result['index.html']=result['index.html'].replace('</head>','<link rel="stylesheet" href="/assets/receipt-review-20261009.css"></head>');
 for(const[n,data]of Object.entries(result)){const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}return Object.keys(result);
}
module.exports={build};if(require.main===module)console.log(JSON.stringify(build(...process.argv.slice(2)),null,2));

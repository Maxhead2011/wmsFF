// FIX: patch only reviewed methods in a fresh runtime, retaining every unrelated module/asset.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),ts=require(root+'/node_modules/typescript'),web=root+'/apps/web',rw=createRequire(web+'/package.json'),rv=createRequire(rw.resolve('vite/package.json'));
const esbuild=rv('esbuild'),{parseAst}=rv('rollup/parseAst');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const BILLING_PIN='db05d116ccd4ccedf2a7930feff4a8c89b90fcbca24574c470d9c4f1792b4687';
function edits(source,changes){let out=source;for(const[a,b]of changes){if(out.split(a).length!==2)throw Error('Ambiguous runtime marker '+a.slice(0,90));out=out.replace(a,()=>b)}let undo=out;for(const[a,b]of [...changes].reverse())undo=undo.replace(b,()=>a);if(undo!==source)throw Error('Reverse patch mismatch');return out;}
function tokens(s){const scan=ts.createScanner(ts.ScriptTarget.ES2022,true,ts.LanguageVariant.Standard,s),out=[];while(scan.scan()!==ts.SyntaxKind.EndOfFileToken)out.push(scan.getTokenText());return JSON.stringify(out);}
function classNode(s,name){const ast=ts.createSourceFile('runtime.js',s,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);let found;function visit(n){if((ts.isClassExpression(n)||ts.isClassDeclaration(n))&&n.name?.text===name)found=n;ts.forEachChild(n,visit)}visit(ast);if(!found)throw Error('Class not found '+name);return found;}
function method(s,name,member){const n=classNode(s,name).members.find(n=>n.name?.getText()===member);if(!n)throw Error('Method missing '+member);return s.slice(n.getStart(),n.end);}
function oldCompiled(file){const source=cp.execFileSync('git',['show','081dbc30:wms/apps/api/src/'+file.replace(/\.js$/,'.ts')],{cwd:root,encoding:'utf8'});return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;}
function transplant(source,previous,current,name,replace,add=[]){const changes=replace.map(n=>{const old=method(source,name,n);if(tokens(old)!==tokens(method(previous,name,n)))throw Error('Unreviewed live method drift '+name+'.'+n);return [old,method(current,name,n)]});let out=edits(source,changes);if(add.length){const n=classNode(out,name);out=out.slice(0,n.end-1)+'\n'+add.map(m=>method(current,name,m)).join('\n')+'\n'+out.slice(n.end-1)}return out;}
function patchApi(source,current,file){
 if(file.endsWith('billing-period.service.js')){
  let out=transplant(source,oldCompiled(file),current,'BillingPeriodService',['previewPeriod','generatePeriod','input','requireScope','load'],['doneRequestsCapabilities','loadDoneRequests']);
  return edits(out,[[ 'const billing_mutation_1 = require("./billing-mutation");','const billing_mutation_1 = require("./billing-mutation");\nconst billing_done_requests_policy_1 = require("./billing-done-requests.policy");']]);
 }
 if(file.endsWith('billing.controller.js')){
  const out=transplant(source,oldCompiled(file),current,'BillingController',[],['doneRequestsCapabilities']);
  const decorator=current.match(/__decorate\(\[\s*\(0, common_1.Get\)\('invoices\/done-requests\/capabilities'\)[\s\S]*?\], BillingController.prototype, "doneRequestsCapabilities", null\);/);
  if(!decorator)throw Error('Capability decorator missing');return out+'\n'+decorator[0]+'\n';
 }
 if(file.endsWith('generate-billing-period.dto.js')){
  const decorator=current.match(/__decorate\(\[\s*\(0, class_validator_1.IsOptional\)\(\),\s*\(0, class_validator_1.IsBoolean\)\(\),\s*__metadata\("design:type", Boolean\)\s*\], PreviewBillingPeriodDto.prototype, "doneRequests", void 0\);/);
  if(!decorator)throw Error('DTO validation missing');return source+'\n'+decorator[0]+'\n';
 }
 if(file.endsWith('billing.service.js'))return transplant(source,oldCompiled(file),current,'BillingService',['writePeriodDraft']);
 if(file.endsWith('administration-internal-api.service.js'))return edits(source,[['routeCount: 43, // FIX: JSON POST preview','routeCount: 44, // FIX: JSON POST preview']]);
 throw Error('Unsupported runtime file '+file);
}
function patchWeb(source,panel){if(sha(source)!==BILLING_PIN)throw Error('Billing graph drift');const out=edits(source,[
 ['function ia({session:t}){',panel+'\nfunction ia({session:t}){'],
 ['children:[a?e.jsx("button",{className:"primary-button",type:"button",onClick:()=>Ge(!0)',
  'children:[a?e.jsx(__billingDoneRequests.BillingDoneRequestsButton,{session:t,clients:h.data,clientId:O||void 0,disabled:h.status!=="ready",onCreated:()=>{Ee()}}):null,a?e.jsx("button",{className:"primary-button",type:"button",onClick:()=>Ge(!0)']
 ]);parseAst(out);return out;}
async function build(base,candidate,compiled,out){
 if(fs.existsSync(out))throw Error('Fresh release output required');fs.mkdirSync(out,{recursive:true});fs.mkdirSync(out+'/api');fs.mkdirSync(out+'/web');
 const source=`import {useState,useEffect} from 'react';import {BillingPeriodGenerationDialog} from './src/components/billing/BillingPeriodGenerationDialog';import {fetchBillingDoneRequestsCapabilities} from './src/lib/api';
 export function BillingDoneRequestsButton(p){const[enabled,setEnabled]=useState(false),[open,setOpen]=useState(false);useEffect(()=>{let active=true;setEnabled(false);fetchBillingDoneRequestsCapabilities(p.session.accessToken).then(v=>{if(active)setEnabled(v.enabled)}).catch(()=>{if(active)setEnabled(false)});return()=>{active=false}},[p.session.accessToken]);return enabled?<><button type="button" className="primary-button" disabled={p.disabled} onClick={()=>setOpen(true)}>Создать счёт по сданным заявкам</button>{open?<BillingPeriodGenerationDialog doneRequests session={p.session} clients={p.clients} clientId={p.clientId} periodFrom="" periodTo="" onClose={()=>setOpen(false)} onCreated={p.onCreated}/>:null}</>:null}`;
 const b=await esbuild.build({stdin:{contents:source,loader:'tsx',resolveDir:web},bundle:true,write:false,format:'iife',globalName:'__billingDoneRequests',jsx:'transform',jsxFactory:'r.createElement',jsxFragment:'r.Fragment',minify:true,
  define:{'import.meta.env.VITE_API_URL':'"/api/v1"'},plugins:[{name:'live-react',setup(b){b.onResolve({filter:/^react(\/jsx-runtime)?$/},a=>({path:a.path,namespace:'live'}));b.onLoad({filter:/.*/,namespace:'live'},a=>({contents:a.path==='react'?'export const useState=r.useState,useEffect=r.useEffect,useRef=r.useRef;':'export const jsx=e.jsx,jsxs=e.jsxs,Fragment=e.Fragment;'}));}}]});
 const dir=root+'/work/done-requests-base-web',html=fs.readFileSync(dir+'/index.html','utf8'),entry=html.match(/src="\/assets\/([^"/]+\.js)"/)[1],graph=new Map(),stack=[entry];
 while(stack.length){const n=stack.pop();if(graph.has(n))continue;const s=fs.readFileSync(dir+'/assets/'+n,'utf8');graph.set(n,s);for(const m of s.matchAll(/["']([^"']+\.js)["']/g)){const ref=path.basename(m[1]);if(fs.existsSync(dir+'/assets/'+ref)&&!graph.has(ref))stack.push(ref)}}
 const targets=[...graph].filter(([,s])=>sha(s)===BILLING_PIN);if(targets.length!==1)throw Error('Pinned billing module missing');
 const target=targets[0][0],names=Object.fromEntries([...graph.keys()].map((n,i)=>[n,`billing-done-requests-20261003-${i}.js`])),files={};
 for(const[n,s]of graph){const next=(n===target?patchWeb(s,b.outputFiles[0].text):s).replace(/[\w.-]+\.js/g,v=>names[v]||v);parseAst(next);fs.writeFileSync(out+'/web/'+names[n],next);files[names[n]]={sha256:sha(next),original:n,originalSha256:sha(s)}}
 const index=edits(html,[['/assets/'+entry,'/assets/'+names[entry]]]);fs.writeFileSync(out+'/web/index.html',index);
 fs.writeFileSync(out+'/web/proof.json',JSON.stringify({indexBeforeSha:sha(html),indexAfterSha:sha(index),files,billing:names[target],entry:names[entry]},null,2));
 const api={};for(const file of ['modules/billing/billing-period.service.js','modules/billing/billing.controller.js','modules/billing/billing.service.js','modules/billing/dto/generate-billing-period.dto.js','modules/administration/administration-internal-api.service.js','modules/billing/billing-done-requests.policy.js']){
  const p=candidate+'/'+file;const current=fs.readFileSync(compiled+'/'+file,'utf8');const next=file.endsWith('billing-done-requests.policy.js')?current:patchApi(fs.readFileSync(p,'utf8'),current,file);
  new Function(next);for(const d of [candidate,out+'/api']){fs.mkdirSync(path.dirname(d+'/'+file),{recursive:true});fs.writeFileSync(d+'/'+file,next)}api[file]=sha(next);
 }
 fs.writeFileSync(out+'/api/proof.json',JSON.stringify(api,null,2));fs.copyFileSync(base+'/manifest.json',out+'/manifest.json');console.log(JSON.stringify({apiFiles:Object.keys(api),webChunks:graph.size,billing:names[target],entry:names[entry]}));
}
module.exports={edits,tokens,transplant,patchWeb,patchApi,build};if(require.main===module)build(...process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1});

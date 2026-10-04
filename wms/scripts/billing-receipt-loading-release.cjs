// FIX: publish only the receipt loading fix on the verified live graph, preserving all other runtime code.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const web=path.resolve(__dirname,'../apps/web'),rw=createRequire(web+'/package.json'),rv=createRequire(rw.resolve('vite/package.json')),{parseAst}=rv('rollup/parseAst'),esbuild=rv('esbuild');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const PIN='f3263a119dd264a55a188be31d7f1695a7b8b8c673993a6366978bedebe4450e';
const oldPending='const pending=[load(()=>xn(t.accessToken),k,clients=>{te(current=>Lt(current,clients));g(current=>Lt(current,clients))}),load(()=>At(t.accessToken),u),load(()=>bn(t.accessToken),T)];';
const newPending='const pending=[load(()=>xn(t.accessToken),k,clients=>{te(current=>Lt(current,clients));g(current=>Lt(current,clients))}),load(()=>bn(t.accessToken),T)];if(d==="cash-receipt"&&!B)u({status:"ready",data:[]});else pending.push(load(()=>At(t.accessToken,d==="cash-receipt"?{clientId:B}:undefined),u));';
const oldForm='d==="cash-receipt"&&a&&h.status==="ready"&&o.status==="ready"?e.jsx(__billingCorrectedCashReceipt.BillingCashReceiptPanel,{clients:h.data,invoices:o.data,session:t,onPaid:ys}):null';
const newForm='d==="cash-receipt"&&a&&(__billingFast||h.status==="ready"&&o.status==="ready")?e.jsx(__billingReceiptLoading.BillingCashReceiptPanel,{clients:h.status==="ready"?h.data:[],invoices:o.status==="ready"?o.data:[],session:t,onPaid:ys,loading:__billingFast&&(["idle","loading"].includes(h.status)||["idle","loading"].includes(o.status)),loadError:__billingFast?h.error||o.error:undefined,onRetry:__billingFast?()=>__billingVisible():undefined}):null';
function applyEdits(source,pairs){
 let result=source;
 for(const [from,to]of pairs){assert.equal(result.split(from).length,2,'Missing or ambiguous patch marker');result=result.replace(from,()=>to);}
 let undo=result;for(const [from,to]of [...pairs].reverse())undo=undo.replace(to,()=>from);
 assert.equal(undo,source,'Unexpected patch delta');return result;
}
function patch(source,panel){
 assert.equal(sha(source),PIN,'Pinned billing runtime drift');
 const result=applyEdits(source,[[oldPending,newPending],[oldForm,newForm],['function ia({session:t}){',panel+'\nfunction ia({session:t}){']]);
 parseAst(result);return result;
}
async function build(base,out){
 if(fs.existsSync(out))throw Error('Fresh output directory required');
 const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'))),folder=path.join(base,'web');
 const expected=manifest.artifacts['web-runtime.tar.gz'].files;
 for(const [name,digest]of Object.entries(expected))assert.equal(sha(fs.readFileSync(path.join(folder,name))),digest,'Baseline checksum '+name);
 const html=fs.readFileSync(path.join(folder,'index.html'),'utf8'),entry=html.match(/src="\/assets\/([^"/]+\.js)"/)[1],graph=new Map(),stack=[entry];
 while(stack.length){const name=stack.pop();if(graph.has(name))continue;const source=fs.readFileSync(path.join(folder,'assets',name),'utf8');graph.set(name,source);for(const m of source.matchAll(/["']([^"']+\.js)["']/g)){const ref=path.basename(m[1]);if(fs.existsSync(path.join(folder,'assets',ref))&&!graph.has(ref))stack.push(ref);}}
 const targets=[...graph].filter(([,s])=>sha(s)===PIN);assert.equal(targets.length,1,'Pinned billing chunk missing');
 const built=await esbuild.build({entryPoints:[web+'/src/components/billing/BillingCashReceiptPanel.tsx'],bundle:true,write:false,format:'iife',globalName:'__billingReceiptLoading',jsx:'transform',jsxFactory:'r.createElement',jsxFragment:'r.Fragment',minify:true,define:{'import.meta.env.VITE_API_URL':'"/api/v1"'},plugins:[{name:'live-react',setup(b){b.onResolve({filter:/^react(\/jsx-runtime)?$/},a=>({path:a.path,namespace:'live'}));b.onLoad({filter:/.*/,namespace:'live'},a=>({contents:a.path==='react'?'export default r;export const useState=r.useState,useEffect=r.useEffect,useMemo=r.useMemo,useCallback=r.useCallback,useRef=r.useRef,forwardRef=r.forwardRef,createElement=r.createElement;':'export const jsx=e.jsx,jsxs=e.jsxs,Fragment=e.Fragment;'}));}}]});
 const names=Object.fromEntries([...graph.keys()].map((n,i)=>[n,`billing-receipt-loading-20261005-${i}.js`])),files={};
 fs.mkdirSync(out+'/web',{recursive:true});
 for(const [name,source]of graph){const updated=(name===targets[0][0]?patch(source,built.outputFiles[0].text):source).replace(/[\w.-]+\.js/g,n=>names[n]||n);parseAst(updated);fs.writeFileSync(out+'/web/'+names[name],updated);files[names[name]]={sha256:sha(updated),original:name,originalSha256:sha(source)};}
 const index=applyEdits(html,[['/assets/'+entry,'/assets/'+names[entry]]]);fs.writeFileSync(out+'/web/index.html',index);
 fs.writeFileSync(out+'/web/proof.json',JSON.stringify({indexBeforeSha:sha(html),indexAfterSha:sha(index),files,entry:names[entry],billing:names[targets[0][0]],sourceParityVerified:false},null,2));
 fs.copyFileSync(base+'/manifest.json',out+'/manifest.json');
 console.log(JSON.stringify({webChunks:graph.size,apiChanged:false,downloadsChanged:false,reversePatchVerified:true}));
}
module.exports={patch,applyEdits,PIN};if(require.main===module)build(...process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1});

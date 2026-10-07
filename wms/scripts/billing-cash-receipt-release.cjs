// FIX: replace only the incoming receipt component in the pinned current billing graph.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const {edits}=require('./billing-done-requests-release.cjs');
const web=path.resolve(__dirname,'../apps/web'),rw=createRequire(web+'/package.json'),rv=createRequire(rw.resolve('vite/package.json')),{parseAst}=rv('rollup/parseAst'),esbuild=rv('esbuild');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const PIN='7ecc8a6bd72ad389800a74fa386bd2898740122400ec89c42202a62477c21c33';
function patch(source,panel){if(sha(source)!==PIN)throw Error('Live billing graph drift');const next=edits(source,[['function ia({session:t}){',panel+'\nfunction ia({session:t}){'],['e.jsx(Gn,{clients:h.data,invoices:o.data,session:t,onPaid:ys})','e.jsx(__billingCashReceipt.BillingCashReceiptPanel,{clients:h.data,invoices:o.data,session:t,onPaid:ys})']]);parseAst(next);return next}
async function build(base,out){
 if(fs.existsSync(out+'/web'))throw Error('Fresh web output required');fs.mkdirSync(out+'/web',{recursive:true});
 const built=await esbuild.build({entryPoints:[web+'/src/components/billing/BillingCashReceiptPanel.tsx'],bundle:true,write:false,format:'iife',globalName:'__billingCashReceipt',jsx:'transform',jsxFactory:'r.createElement',jsxFragment:'r.Fragment',minify:true,define:{'import.meta.env.VITE_API_URL':'"/api/v1"'},plugins:[{name:'live-react',setup(b){b.onResolve({filter:/^react(\/jsx-runtime)?$/},a=>({path:a.path,namespace:'live'}));b.onLoad({filter:/.*/,namespace:'live'},a=>({contents:a.path==='react'?'export default r;export const useState=r.useState,useEffect=r.useEffect,useMemo=r.useMemo,useCallback=r.useCallback,useRef=r.useRef,forwardRef=r.forwardRef,createElement=r.createElement;':'export const jsx=e.jsx,jsxs=e.jsxs,Fragment=e.Fragment;'}));}}]});
 const html=fs.readFileSync(base+'/index.html','utf8'),entry=html.match(/src="\/assets\/([^"/]+\.js)"/)[1],graph=new Map(),stack=[entry];
 while(stack.length){const n=stack.pop();if(graph.has(n))continue;const s=fs.readFileSync(base+'/assets/'+n,'utf8');graph.set(n,s);for(const m of s.matchAll(/["']([^"']+\.js)["']/g)){const ref=path.basename(m[1]);if(fs.existsSync(base+'/assets/'+ref)&&!graph.has(ref))stack.push(ref)}}
 const targets=[...graph].filter(([,s])=>sha(s)===PIN);if(targets.length!==1)throw Error('Pinned billing missing');
 const names=Object.fromEntries([...graph.keys()].map((n,i)=>[n,`billing-partial-payment-20261003-${i}.js`])),files={};
 for(const[n,s]of graph){const next=(n===targets[0][0]?patch(s,built.outputFiles[0].text):s).replace(/[\w.-]+\.js/g,v=>names[v]||v);parseAst(next);fs.writeFileSync(out+'/web/'+names[n],next);files[names[n]]={sha256:sha(next),original:n,originalSha256:sha(s)}}
 const index=edits(html,[['/assets/'+entry,'/assets/'+names[entry]]]);fs.writeFileSync(out+'/web/index.html',index);fs.writeFileSync(out+'/web/proof.json',JSON.stringify({indexBeforeSha:sha(html),indexAfterSha:sha(index),files,billing:names[targets[0][0]],entry:names[entry]},null,2));console.log(JSON.stringify({webChunks:graph.size}));
}
module.exports={patch,build};if(require.main===module)build(...process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1});

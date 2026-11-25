// FIX: exact live web delta; preserve every unrelated published module.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const esbuild=require('../../../node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild');
(async()=>{const w=process.argv[2],out=path.join(w,'web');fs.mkdirSync(path.join(out,'assets'),{recursive:true});
await esbuild.build({entryPoints:['wms/apps/web/src/components/fbs/requestSupplyAction.ts'],bundle:true,format:'esm',outfile:path.join(out,'assets/wb-request-policy-20261125.js')});
const write=(n,s)=>fs.writeFileSync(path.join(out,n),s);const replace=(s,a,b)=>{assert.equal(s.split(a).length,2,a);return s.replace(a,b)};
let root=fs.readFileSync(path.join(w,'web.js'),'utf8');root=replace(root,'onOpenFbsOrders:()=>{const target=__readRequestSupply();','onOpenFbsOrders:(request)=>{const target=__readRequestSupply();');root=replace(root,'return;}r("fbs")},focusRequestId:d','return;}__rememberFbsClient(n.user.id,request?.clientId);r("fbs")},focusRequestId:d');
write('assets/wb-request-host-20261125.js','import {rememberFbsRequestClient as __rememberFbsClient} from "/assets/wb-request-policy-20261125.js";\n'+root);
let fbs=fs.readFileSync(path.join(w,'fbs.js'),'utf8');fbs=replace(fbs,'h(E=>fr(E,y,y.length===1?y[0].id:""))','h(E=>requestTarget?.request.clientId||fr(E,y,y.length===1?y[0].id:""))');fbs=replace(fbs,'h(E=>{var G;return y.some(D=>D.client.id===E)?E:((G=y[0])==null?void 0:G.client.id)??E})','h(E=>__retainFbsClient(E,y,requestTarget?.request.clientId))');fbs=replace(fbs,'if(target.request.status==="DONE"){','if(__requestNeedsArchive(target)){');
fbs=replace(fbs,'.filter(m=>m.category===g)','.filter(m=>__fbsDisplayCategory(m)===g)');fbs=replace(fbs,'n=i=>r.filter(l=>l.category===i).length','n=i=>r.filter(l=>__fbsDisplayCategory(l)===i).length');
write('assets/wb-request-fbs-20261125.js','import {fbsDisplayCategory as __fbsDisplayCategory,retainFbsClient as __retainFbsClient,requestSupplyNeedsArchive as __requestNeedsArchive} from "/assets/wb-request-policy-20261125.js";\n'+fbs);
let html=fs.readFileSync(path.join(w,'index.html'),'utf8');html=html.replaceAll('/assets/payroll-advances-20261124.js','/assets/wb-request-host-20261125.js').replaceAll('/assets/ozon-pre-pick-fbs-20261125.js','/assets/wb-request-fbs-20261125.js');write('index.html',html);
})().catch(e=>{console.error(e);process.exitCode=1});

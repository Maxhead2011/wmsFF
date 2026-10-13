// FIX: exact delta against the verified runtime; preserve all legacy WB/TSD behavior.
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),ts=require('../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('./single-react-graph.cjs');
const root=process.argv[2],w=path.resolve(__dirname,'..'),repo=path.dirname(w),changes=[];
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Unique anchor: '+a);return s.replace(a,b);};
function edit(n,fn){const p=path.join(root,'api',n);fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));changes.push(n);}
for(const n of ['client-requests/ozon-supply-policy','client-requests/ozon-assembly-supply.service','tsd/ozon-adjustment-policy','tsd/ozon-stock-adjustment.service','tsd/ozon-stock-adjustment.controller']){
 const source='wms/apps/api/src/modules/'+n+'.ts',dest=path.join(root,'api/modules',n+'.js');
 if(n.startsWith('client-requests'))assert.equal(fs.readFileSync(dest,'utf8').replace(/\r/g,''),compile(cp.execFileSync('git',['show','cf587082:'+source],{cwd:repo,encoding:'utf8'})).replace(/\r/g,''),'Base parity: '+n);
 fs.writeFileSync(dest,compile(fs.readFileSync(path.join(repo,source),'utf8')));changes.push('modules/'+n+'.js');
}
edit('modules/tsd/tsd.module.js',s=>once(once(s,'controllers: [','controllers: [require("./ozon-stock-adjustment.controller").OzonStockAdjustmentController, '),'providers: [','providers: [require("./ozon-stock-adjustment.service").OzonStockAdjustmentService, require("../client-requests/ozon-assembly-supply.service").OzonAssemblySupplyService, '));
edit('modules/tsd/fbo-two-stage.service.js',s=>{
 s=once(s,'    async snapshot(tx, r, context = {}) {',`    async adjustmentContext(tx,id,user) {const request=await this.load(tx,id,user,'write');this.requireFbo(request);return {request,plan:await this.snapshot(tx,request)};}
    async snapshot(tx, r, context = {}) {`);
 s=once(s,'const waitingBySku = new Map();','const waitingBySku = new Map();const pendingLocations=[];');
 s=once(s,'waitingBySku.set(balance.skuId, (waitingBySku.get(balance.skuId) ?? 0) + quantity);','waitingBySku.set(balance.skuId, (waitingBySku.get(balance.skuId) ?? 0) + quantity);pendingLocations.push({skuId:balance.skuId,boxCode:box.code,pallet:box.pallet?.code??"",zone:box.zone?.name??"",quantity});');
 return once(s,'return { pendingPlacementQuantity,','return { pendingLocations, pendingPlacementQuantity,');
});
edit('modules/administration/administration-internal-api.service.js',s=>once(once(s,"prefixes: ['/tsd', '/tsd/requests/:id/fbo'],","prefixes: ['/tsd', '/tsd/requests/:id/fbo', '/tsd/requests/:id/fbo/ozon-adjustment'],"),'routeCount: 94,','routeCount: 99,'));
const input=path.join(root,'web-base'),output=path.join(root,'web'),cache={};
const files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];
const chunk='assets/'+fs.readdirSync(path.join(input,'assets')).find(n=>files['assets/'+n]?.includes('var __OnlinePanel='));let s=files[chunk];assert.ok(s,'Pinned panel');
const read=n=>fs.readFileSync(path.join(w,'apps/web/src',n),'utf8').replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'');
// Keep the existing progress/table/history function and add only unplaced locations.
s=once(s,'p.pendingPlacementQuantity>0?',`(s.pendingLocations??[]).filter(v=>v.skuId===p.skuId).map(v=>e.jsxs("div",{children:["Короб ",v.boxCode," · ",v.pallet||"Паллет-сорт не назначен",v.zone?" · "+v.zone:""," · ",v.quantity," шт. · ожидает размещения"]},v.boxCode)),p.pendingPlacementQuantity>0?`);
const helpers='const React=o;const {useState,useEffect,useRef}=o;const FboProgress=Ii,startFboPolling=Ci,fetchFboPlan=$a,actFbo=Oa,downloadFboWbFile=Ma,startVisiblePolling=__OnlineWindow.startVisiblePolling;\n';
const api=`async function ozonAdjustment(t,id,a,body={}){const r=await fetch('/api/v1/tsd/requests/'+encodeURIComponent(id)+'/fbo/ozon-adjustment'+(a?'/'+a:''),{method:a?'POST':'GET',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},...(a?{body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(v.message??('HTTP '+r.status));return v;}\n`;
const build=contents=>esbuild.buildSync({stdin:{contents,loader:'tsx'},define:{'import.meta.env.VITE_MENU_READS_ENABLED':'"true"'},bundle:true,write:false,format:'iife',globalName:'__OnlinePanel',minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text.trim();
const oldRead=n=>cp.execFileSync('git',['show','cf587082:wms/apps/web/src/'+n],{cwd:repo,encoding:'utf8'}).replace(/^import .*;\r?\n/gm,'');
const old=build(helpers+oldRead('lib/assemblyProductDisplay.ts')+oldRead('components/client-requests/FboTwoStagePanel.tsx'));
const start=s.indexOf('var __OnlinePanel=');assert.equal(s.slice(start).trim(),old,'Published Ozon panel must match its source base');
s=s.slice(0,start)+build(helpers+api+read('lib/assemblyProductDisplay.ts')+read('components/client-requests/OzonStockAdjustment.tsx')+read('components/client-requests/FboTwoStagePanel.tsx'))+'\n';cache[chunk]=s;
const result=repair(files,entry,entry,'ozon-adjustment-20261013');for(const[n,data]of Object.entries(result)){const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
fs.writeFileSync(path.join(root,'api-changes.json'),JSON.stringify(changes));fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(Object.keys(result)));console.log(JSON.stringify({api:changes,web:Object.keys(result).length}));

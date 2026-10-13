// FIX: exact delta against the verified runtime; preserve all legacy WB/TSD behavior.
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('../../single-react-graph.cjs');
const root=process.argv[2],w=path.resolve(__dirname,'../../..'),repo=path.dirname(w),changes=[];
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Unique anchor: '+a);return s.replace(a,b);};
function edit(n,fn){const p=path.join(root,'api',n);fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));changes.push(n);}
for(const n of ['tsd/ozon-stock-adjustment.service','tsd/ozon-stock-adjustment.controller','tsd/ozon-request-sync-policy']){
 const source='wms/apps/api/src/modules/'+n+'.ts',dest=path.join(root,'api/modules',n+'.js');
 if(fs.existsSync(dest))assert.equal(fs.readFileSync(dest,'utf8').replace(/\r/g,''),compile(cp.execFileSync('git',['show','f96ca1c224f15ef9e48f06411c9b48a33b0e9604:'+source],{cwd:repo,encoding:'utf8'})).replace(/\r/g,''),'Base parity '+n);
 fs.writeFileSync(dest,compile(fs.readFileSync(path.join(repo,source),'utf8')));changes.push('modules/'+n+'.js');
}
edit('modules/administration/administration-internal-api.service.js',s=>once(s,'routeCount: 99,','routeCount: 101,'));
const input=path.join(root,'web-base'),output=path.join(root,'web'),cache={};
const files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];
const chunk='assets/'+fs.readdirSync(path.join(input,'assets')).find(n=>files['assets/'+n]?.includes('var __OnlinePanel='));let s=files[chunk];assert.ok(s,'Pinned panel');
const read=n=>fs.readFileSync(path.join(w,'apps/web/src',n),'utf8').replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'');
const helpers='const React=o;const {useState,useEffect,useRef}=o;const FboProgress=Ii,startFboPolling=Ci,fetchFboPlan=$a,actFbo=Oa,downloadFboWbFile=Ma,startVisiblePolling=__OnlineWindow.startVisiblePolling;\n';
const api=`async function ozonAdjustment(t,id,a,body={}){const r=await fetch('/api/v1/tsd/requests/'+encodeURIComponent(id)+'/fbo/ozon-adjustment'+(a?'/'+a:''),{method:a?'POST':'GET',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},...(a?{body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(v.message??('HTTP '+r.status));return v;}\n`;
const build=contents=>esbuild.buildSync({stdin:{contents,loader:'tsx'},define:{'import.meta.env.VITE_MENU_READS_ENABLED':'"true"'},bundle:true,write:false,format:'iife',globalName:'__OnlinePanel',minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text.trim();
const oldRead=n=>cp.execFileSync('git',['show','f96ca1c224f15ef9e48f06411c9b48a33b0e9604:wms/apps/web/src/'+n],{cwd:repo,encoding:'utf8'}).replace(/^import .*;\r?\n/gm,'');
const old=build(helpers+api+oldRead('lib/assemblyProductDisplay.ts')+oldRead('components/client-requests/OzonStockAdjustment.tsx')+oldRead('components/client-requests/FboTwoStagePanel.tsx'));
const start=s.indexOf('var __OnlinePanel=');assert.equal(s.slice(start).trim(),old,'Published Ozon panel must match its source base');
s=s.slice(0,start)+build(helpers+api+"const ozonSync=ozonAdjustment;\n"+read('lib/assemblyProductDisplay.ts')+read('components/client-requests/OzonStockAdjustment.tsx')+read('components/client-requests/FboTwoStagePanel.tsx'))+'\n';cache[chunk]=s;
const result=repair(files,entry,entry,'ozon-sync-20261013');for(const[n,data]of Object.entries(result)){const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
fs.writeFileSync(path.join(root,'api-changes.json'),JSON.stringify(changes));fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(Object.keys(result)));console.log(JSON.stringify({api:changes,web:Object.keys(result).length}));


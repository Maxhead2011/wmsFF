// Exact runtime overlay. Every insertion is anchored to the captured live modules.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const ts=require('../../../node_modules/typescript'),esbuild=require('../../../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild');
const r=path.resolve(process.argv[2]),w=process.cwd(),read=p=>fs.readFileSync(p,'utf8');
function save(n,s){const p=path.join(r,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
function once(s,a,b){assert.equal(s.split(a).length,2,'Expected unique anchor '+a.slice(0,80));return s.replace(a,()=>b);}
function api(n,fn){save('api/payload/'+n,fn(read(path.join(r,'candidate',n))));}
const mod='modules/client-requests/';
const controller='request-market-status.controller';
save('api/payload/'+mod+controller+'.js',ts.transpileModule(read(w+'/apps/api/src/'+mod+controller+'.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText);
api(mod+'client-requests.module.js',s=>once(s,'controllers: [wb_tracking_controller.','controllers: [require("./request-market-status.controller").RequestMarketStatusController,wb_tracking_controller.'));
api(mod+'wb-fbo-supply.service.js',s=>once(once(once(s,'async refresh(id, user) {','async refresh(id, user, manual=false) {'),'if (Date.now() - Date.parse(before.attemptedAt','if (!manual && Date.now() - Date.parse(before.attemptedAt'),"if (r.status === 'PACKED' && r.fboAssembly?.phase === 'COMPLETED' && snapshot","if (!manual && r.status === 'PACKED' && r.fboAssembly?.phase === 'COMPLETED' && snapshot"));
api(mod+'fbo-delivery-sync.service.js',s=>once(once(s,'async reconcile(id, initial) {','async reconcile(id, initial, scope) {'),'let evidence, accepted = false;', "if(scope && (c.r.clientId!==scope.clientId || c.r.warehouseId!==scope.warehouseId)) throw new common_1.ConflictException('Заявка сменила клиента или филиал. Обновите список.');\n        let evidence, accepted = false;"));
api('modules/administration/administration-internal-api.service.js',s=>{const start=s.indexOf("'/client-requests/:id/wb-fbo-supply'");assert(start>0);return s.slice(0,start)+once(s.slice(start,start+225),'routeCount: 64','routeCount: 66')+s.slice(start+225);});
const old='assets/compact-places-20261101.js',next='assets/panthera-market-buttons-20261101.js';
const src=w+'/apps/web/src/components/client-requests/';
function component(name,test){const ast=ts.createSourceFile('file.tsx',read(src+name+'.tsx'),99,true,ts.ScriptKind.TSX);return ast.statements.filter(test).map(n=>n.getText(ast)).join('\n');}
const wrapper=component('WbFboSupply',n=>n.name?.text==='WbSupplyWindow');
const batch=component('MarketStatusBatch',n=>!ts.isImportDeclaration(n));
const prelude=`const React={get Fragment(){return o.Fragment},createElement:(...args)=>o.createElement(...args)};
const useState=(...a)=>o.useState(...a),useRef=(...a)=>o.useRef(...a),useEffect=(...a)=>o.useEffect(...a);
const WbFboSupply=props=>o.createElement(__WbTracking.WbFboSupply,props);
const RefreshCw=()=>o.createElement('span',{'aria-hidden':true},'↻');
const requestStatusLabel=s=>bn(s);
async function remote(token,path,method){const res=await fetch('/api/v1/client-requests/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});const data=await res.json();if(!res.ok)throw Error(data.message||'Ошибка проверки статуса');return data;}
const marketStatusTargets=t=>remote(t,'market-status/targets','GET'),checkRequestMarketStatus=(t,id)=>remote(t,encodeURIComponent(id)+'/market-status','POST');
`;
const add=esbuild.buildSync({stdin:{contents:prelude+wrapper+'\n'+batch,loader:'tsx'},bundle:true,minify:true,format:'iife',globalName:'__MarketButtons',write:false,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;
let s=read(path.join(r,'web-base',old));
const panel='e.createElement("div",{className:$embedded?"fbo-inline-execution__actions":"online-execution-modal__actions"},';
const wb='(!t.marketplace||t.marketplace==="WILDBERRIES")&&e.createElement(';
s=once(s,panel,panel+wb+'__MarketButtons.WbSupplyWindow,{key:t.requestId,requestId:t.requestId,accessToken:r}),');
s=once(s,','+wb+'__WbTracking.WbFboSupply,{key:t.requestId,requestId:t.requestId,accessToken:r,disabled:s||!!h||K})','');
s=once(s,'__batch=__BatchFeatures.useRequestBatch({items:Is.data', '[__marketBusy,__setMarketBusy]=o.useState(false),__batch=__BatchFeatures.useRequestBatch({checkingMarkets:__marketBusy,marketControl:h&&!s?(busy)=>o.createElement(__MarketButtons.MarketStatusBatch,{key:t.user.id+String(t.user.activeWarehouseId),token:t.accessToken,reload:ke,disabled:busy,onBusy:__setMarketBusy}):undefined,items:Is.data');
const a=s.indexOf('function H({items:e,enabled:t,token:n,fetchSelection:s,updateStatus:r,reload:i})'),z=s.indexOf('function se(',a);assert(a>0&&z>a);
let hook=s.slice(a,z).replace('items:e,enabled:t','checkingMarkets:mb,marketControl:mc,items:e,enabled:t').replace('if(D.current||!t','if(mb||D.current||!t').replaceAll('disabled:c','disabled:mb||c');hook=once(hook,'"),A?__WmsReact.createElement','"),mc?.(c),A?__WmsReact.createElement');
s=s.slice(0,a)+hook+s.slice(z);save('web/payload/'+next,add+'\n'+s);
let html=read(path.join(r,'web-base/index.html'));const m=html.match(/<script type="importmap">(.*?)<\/script>/s);const map=JSON.parse(m[1]);let changed=0;for(const k in map.imports)if(map.imports[k]==='/'+old){map.imports[k]='/'+next;changed++;}assert(changed);map.imports['/'+old]='/'+next;save('web/payload/index.html',once(html,m[1],JSON.stringify(map)));


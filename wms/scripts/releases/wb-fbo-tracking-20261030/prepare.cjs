// FIX: own-WMS exact overlay; preserve the published React entry and all other marketplaces.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root=path.resolve(process.argv[2]),w=path.resolve(__dirname,'../../..');
const read=n=>fs.readFileSync(n,'utf8'),save=(n,s)=>{const p=root+'/'+n;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);};
function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b);}
for(const file of ['wb-fbo-supply.service','wb-fbo-supply.controller','wb-fbo-dispatch'])save('api/payload/modules/client-requests/'+file+'.js',ts.transpileModule(read(w+'/apps/api/src/modules/client-requests/'+file+'.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText);
let n='modules/client-requests/client-requests.module.js',s=read(root+'/candidate-current/'+n);
s='const wb_tracking_controller=require("./wb-fbo-supply.controller"),wb_tracking_service=require("./wb-fbo-supply.service");\n'+s;
s=once(s,'controllers: [','controllers: [wb_tracking_controller.WbFboSupplyController,');s=once(s,'providers: [','providers: [wb_tracking_service.WbFboSupplyService,');save('api/payload/'+n,s);
n='modules/administration/administration-internal-api.service.js';save('api/payload/'+n,once(read(root+'/candidate-current/'+n),'routeCount: 60','routeCount: 64').replace("prefixes: ['/client-request-removal', '/client-requests',","prefixes: ['/client-request-removal', '/client-requests', '/client-requests/:id/wb-fbo-supply',"));
const source=read(w+'/apps/web/src/components/client-requests/WbFboSupply.tsx')+'\n'+read(w+'/apps/web/src/components/client-requests/fboProcess.ts').replace(':requestStatusOptions',':Ea'),ast=ts.createSourceFile('x.tsx',source,99,true,ts.ScriptKind.TSX),body=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n');
const bundle=esbuild.buildSync({stdin:{contents:'const React={get Fragment(){return o.Fragment},createElement:(...a)=>o.createElement(...a)};const useState=(...a)=>o.useState(...a),useEffect=(...a)=>o.useEffect(...a);'+body,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__WbTracking',minify:true,jsx:'transform',jsxFactory:'React.createElement'}).outputFiles[0].text;
const old='assets/client-stores-fbo-progress-wb-20261030.js',next='assets/wb-fbo-tracking-20261030.js';s=read(root+'/web-base/'+old);
const anchor='e.createElement(be,{plan:t,accessToken:r,paused:K||!!h})';
s=once(s,anchor,anchor+',(!t.marketplace||t.marketplace==="WILDBERRIES")&&e.createElement(__WbTracking.WbFboSupply,{key:t.requestId,requestId:t.requestId,accessToken:r,disabled:s||!!h||K})');s=s.replaceAll('value:c.status,onChange:w=>E(c.id,w.target.value),children:Ea.map','value:__WbTracking.fboProcessValue(c),onChange:w=>E(c.id,w.target.value),children:__WbTracking.fboProcessOptions(c).map');
s=s.replaceAll('c.fboProgressLabel??bn(c.status)','(__WbTracking.fboProcessValue(c)==="SHIPPED"?"Отгружено":c.fboProgressLabel??bn(c.status))');save('web/payload/'+next,bundle+'\n'+s);
n='modules/client-requests/client-requests.service.js';s=read(root+'/candidate-current/'+n);
s='const wb_dispatch=require("./wb-fbo-dispatch");\n'+s;
s=once(s,'const stores = await request_store_context_1.requestStoreContexts(this.prisma, requests);','const dispatches=await wb_dispatch.wbDispatchContexts(this.prisma,requests.map(r=>r.id));for(const request of requests)if(dispatches[request.id])Object.assign(request,{fboDispatchAt:dispatches[request.id]});\nconst stores = await request_store_context_1.requestStoreContexts(this.prisma, requests);');s=once(s,'const shouldFinalizeStockRequest =','await wb_dispatch.assertFboProcessChange(this.prisma,id,dto.status);\nconst shouldFinalizeStockRequest =');s=once(s,'return { ...request, ...stores.get(request.id) };', 'const dispatch=await wb_dispatch.wbDispatchContexts(this.prisma,[request.id]);return {...request, ...stores.get(request.id),fboDispatchAt:dispatch[request.id]};');save('api/payload/'+n,s);
const oldCore='assets/client-stores-sidebar-counts-core-20261030.js',newCore='assets/wb-dispatch-core-20261030.js';
s=read(root+'/web-base/'+oldCore);
s=once(s,'async function Wq(t,n,s){return z(', 'async function Wq(t,n,s){if(s.status==="SHIPPED"){if(!window.confirm("Товар фактически загружен в автомобиль?"))throw Error("Отметка отгрузки отменена.");await z(`/client-requests/${n}/wb-fbo-supply/gate`,{method:"POST",accessToken:t});return z(`/client-requests/${n}`,{accessToken:t})}return z(');save('web/payload/'+newCore,s);
let html=read(root+'/web-base/index.html'),m=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(m[1]);
for(const k of Object.keys(map.imports))if(map.imports[k]==='/'+old)map.imports[k]='/'+next;map.imports['/'+old]='/'+next;
for(const k of Object.keys(map.imports))if(map.imports[k]==='/'+oldCore)map.imports[k]='/'+newCore;map.imports['/'+oldCore]='/'+newCore;html=once(html,`src="/${oldCore}"`,`src="/${newCore}"`);save('web/payload/index.html',html.replace(m[1],JSON.stringify(map)));
for(const dir of ['api/payload','web/payload'])for(const f of fs.readdirSync(root+'/'+dir,{recursive:true}))if(f.endsWith('.js'))assert.equal(ts.createSourceFile(f,read(root+'/'+dir+'/'+f),99,true).parseDiagnostics.length,0,f);
console.log('Prepared exact API4/web2');

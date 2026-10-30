// FIX: surgical overlays on verified runtime, retaining unrelated live behavior.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root=path.resolve(process.argv[2]),w=path.resolve(__dirname,'../../..');
const read=n=>fs.readFileSync(n,'utf8'),save=(n,s)=>{const p=root+'/'+n;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);};
const ast=(s,n='x.js')=>ts.createSourceFile(n,s,99,true,n.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.JS);
function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b);}
function method(s,name){const a=ast(s);let found;function visit(n){if(ts.isMethodDeclaration(n)&&n.name.getText(a)===name)found=n.getText(a);ts.forEachChild(n,visit);}visit(a);assert(found,name);return found;}
function compile(n){return ts.transpileModule(read(w+'/apps/api/src/'+n),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;}
let n='modules/client-requests/client-requests.service.js',s=read(root+'/candidate/'+n);
s=once(s,'    async activeFboCounts(',method(compile(n.replace('.js','.ts')),'navigationCounts')+'\n    async activeFboCounts(');save('api/payload/'+n,s);
n='modules/client-requests/client-requests.controller.js';s=read(root+'/candidate/'+n);
s=once(s,'    activeFboCounts(',method(compile(n.replace('.js','.ts')),'navigationCounts')+'\n    activeFboCounts(');
let start=s.lastIndexOf('__decorate([',s.indexOf("(0, common_1.Get)('fbo-active-counts')")),end=s.indexOf('], ClientRequestsController.prototype, "activeFboCounts", null);',start)+'], ClientRequestsController.prototype, "activeFboCounts", null);'.length;
assert(start>=0&&end>start);s=s.slice(0,end)+'\n'+s.slice(start,end).replace('fbo-active-counts','navigation-counts').replace('"activeFboCounts"','"navigationCounts"')+s.slice(end);save('api/payload/'+n,s);
n='modules/administration/administration-internal-api.service.js';s=read(root+'/candidate/'+n);save('api/payload/'+n,once(s,'routeCount: 59','routeCount: 60'));
const source=read(w+'/apps/web/src/components/layout/SidebarRequestCounts.tsx'),a=ast(source,'x.tsx');
const body=a.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(a)).join('\n');
const bundle=esbuild.buildSync({stdin:{contents:'const React={createElement:(...args)=>x.createElement(...args)};const useEffect=(...args)=>x.useEffect(...args),useState=(...args)=>x.useState(...args);'+body,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__SidebarCounts',minify:true,jsx:'transform',jsxFactory:'React.createElement'}).outputFiles[0].text;
const old='assets/ozon-label-history-core-20261030.js',next='assets/sidebar-counts-core-20261030.js';s=read(root+'/web-base/'+old);
s=once(s,'[S,P]=x.useState(0),','[S,P]=x.useState(0),__sidebarCounts=__SidebarCounts.useSidebarRequestCounts(s?null:t,true),');
s=once(s,'e.jsx(__MainFeatures.PantheraNavigation,{','e.jsx(__MainFeatures.PantheraNavigation,{counts:__sidebarCounts,');
s=once(s,'e.jsx("span",{children:ce.title}),ce.id==="kiz"','e.jsx("span",{children:ce.title}),e.jsx(__SidebarCounts.SidebarRequestBadge,{id:ce.id,state:__sidebarCounts}),ce.id==="kiz"');
s=once(s,'function PantheraNavigation({ groups, userId, accessToken, activeId, onOpen, kizUnread })','function PantheraNavigation({ groups, userId, accessToken, activeId, onOpen, kizUnread, counts=null })');
s=once(s,'(0, import_jsx_runtime.jsx)("span", { children: item.title }),','(0, import_jsx_runtime.jsx)("span", { children: item.title }),\n(0, import_jsx_runtime.jsx)(__SidebarCounts.SidebarRequestBadge,{id:item.id,state:counts}),');
save('web/payload/'+next,bundle+'\n'+s);
let html=read(root+'/web-base/index.html'),m=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(m[1]);
for(const k of Object.keys(map.imports))if(map.imports[k]==='/'+old)map.imports[k]='/'+next;map.imports['/'+old]='/'+next;
html=once(html,`src="/${old}"`,`src="/${next}"`).replace(m[1],JSON.stringify(map));save('web/payload/index.html',html);
for(const dir of ['api/payload','web/payload'])for(const f of fs.readdirSync(root+'/'+dir,{recursive:true}))if(f.endsWith('.js'))assert.equal(ast(read(root+'/'+dir+'/'+f)).parseDiagnostics.length,0,f);
console.log('API3/web2 exact overlay prepared');

'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {build}=require('../../../apps/web/node_modules/vite');
const {fixFabricHostScope}=require('./host-scope.cjs');
const root=path.resolve(process.argv[2]),old=fs.readFileSync(path.join(root,'entry.txt'),'utf8').trim(),next='/assets/warehouse-fabric-root-20261109.js';
const read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b)}
(async()=>{
 const source=path.resolve('apps/web/src/components/warehouse/FabricWarehousePanel.tsx');
 await build({root:path.resolve('apps/web'),configFile:false,esbuild:{jsx:'automatic'},plugins:[{name:'existing-react',enforce:'pre',resolveId(id){if(['react','react/jsx-runtime','react/jsx-dev-runtime'].includes(id))return '\0'+id},load(id){if(id==='\0react')return `import{r as R}from'${old}';export{R as default};export function useState(...a){return R.useState(...a)}export function useEffect(...a){return R.useEffect(...a)}export function useRef(...a){return R.useRef(...a)}export function useMemo(...a){return R.useMemo(...a)}export function useCallback(...a){return R.useCallback(...a)}`;if(id.startsWith('\0react/jsx'))return `import{j as J}from'${old}';export function jsx(...a){return J.jsx(...a)}export function jsxs(...a){return J.jsxs(...a)}export function Fragment(p){return p.children}`;}}],build:{outDir:path.join(root,'fabric-web'),emptyOutDir:true,lib:{entry:source,formats:['es'],fileName:()=> 'warehouse-fabric-20261109.js'},rollupOptions:{external:[old]}}});
 assert(!read(path.join(root,'fabric-web/warehouse-fabric-20261109.js')).includes('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED'),'A second React copy is forbidden');
 let js=read(path.join(root,'web-base',old));
 js='import{FabricWarehousePanel as __FabricWarehousePanel}from"./warehouse-fabric-20261109.js";\n'+js;
 js=once(js,'function m5({onOpen:t,clientView=false}){const n=[','function m5({onOpen:t,clientView=false}){const n=[...(window.location.hostname==="wms.logoff.pro"?[{id:"fabrics",eyebrow:"Рулоны и отрезы",title:"Ткани: хранение и учёт",description:"Приёмка рулонов, цвета, остатки и привязка к товарам маркетплейсов.",icon:e.jsx(ki,{size:23})}]:[]),');
 js=once(js,'r==="statistics"?e.jsx(n2,{session:n}):null,','r==="statistics"?e.jsx(n2,{session:n}):null,r==="fabrics"&&window.location.hostname==="wms.logoff.pro"?e.jsx(__FabricWarehousePanel,{session:n}):null,');
 js=fixFabricHostScope(js);
 write(path.join(root,'web-payload',next),js);
 let html=read(path.join(root,'web-base/index.html'));const match=html.match(/<script type="importmap">(.*?)<\/script>/s);const map=JSON.parse(match[1]);
 for(const key of Object.keys(map.imports))if(map.imports[key]===old)map.imports[key]=next;map.imports[old]=next;
 html=html.replace(match[1],()=>JSON.stringify(map));html=once(html,'src="'+old+'"','src="'+next+'"');
 html=once(html,'</head>','<link rel="stylesheet" href="/assets/warehouse-fabric-20261109.css"></head>');
 write(path.join(root,'web-payload/index.html'),html);
 const generated=fs.readdirSync(path.join(root,'fabric-web'));const css=generated.find(n=>n.endsWith('.css'));assert(css);
 write(path.join(root,'web-payload/assets/warehouse-fabric-20261109.css'),read(path.join(root,'fabric-web',css)));
 write(path.join(root,'web-payload/assets/warehouse-fabric-20261109.js'),read(path.join(root,'fabric-web/warehouse-fabric-20261109.js')));
 write(path.join(root,'web-changes.json'),JSON.stringify(['index.html',next.slice(1),'assets/warehouse-fabric-20261109.js','assets/warehouse-fabric-20261109.css']));console.log('Web4 candidate prepared; one shared React/root module.');
})().catch(e=>{console.error(e);process.exitCode=1});

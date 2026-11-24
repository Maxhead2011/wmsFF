// FIX: exact live-entry delta; keep all unrelated published modules and exports.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),work=process.argv[2],out=path.join(work,'web');
const esbuild=require(path.join(root,'node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild'));
(async()=>{
 fs.mkdirSync(path.join(out,'assets'),{recursive:true});
 const bundle=await esbuild.build({entryPoints:[path.join(root,'apps/web/src/components/print/FreeLabelEditor.tsx')],bundle:true,write:false,outfile:'editor.js',format:'iife',globalName:'FreeLabelModule',jsx:'transform',jsxFactory:'React.createElement',jsxFragment:'React.Fragment',target:'es2022',plugins:[{name:'live-bridges',setup(b){
  b.onResolve({filter:/^react\/jsx-runtime$/},()=>({path:'jsx',namespace:'jsx'}));
  b.onLoad({filter:/.*/,namespace:'jsx'},()=>({contents:'const React=globalThis.__freeLabelReact;export const Fragment=React.Fragment;export function jsx(type,props,key){return React.createElement(type,key===undefined?props:{...props,key});}export const jsxs=jsx;',loader:'js'}));
  b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'bridge'}));
  b.onLoad({filter:/.*/,namespace:'bridge'},()=>({contents:'const React=globalThis.__freeLabelReact;export default React;export const {createElement,forwardRef,useState,useEffect,useRef,useMemo,useCallback,createContext,useContext}=React;',loader:'js'}));
  b.onResolve({filter:/lib\/api$/},()=>({path:'api',namespace:'api'}));
  b.onLoad({filter:/.*/,namespace:'api'},()=>({contents:`export async function fetchLabelTemplates(token){const r=await fetch('/api/v1/print/templates',{headers:{Authorization:'Bearer '+token}});const d=await r.json();if(!r.ok)throw Error(d.message||'Не удалось загрузить шаблоны');return d;}`,loader:'js'}));
  b.onResolve({filter:/^pdfjs-dist$/},()=>({path:'/assets/free-label-pdf-20261124.js',external:true}));
  b.onResolve({filter:/pdf\.worker.*\?url$/},()=>({path:'worker',namespace:'worker'}));
  b.onLoad({filter:/.*/,namespace:'worker'},()=>({contents:`export default '/assets/free-label-worker-20261124.js'`,loader:'js'}));
 }}]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
 // JSX transform needs an explicit React binding; actual hooks use the running app's React.
 const wrapper=`var __FreeLabelComponent;function __FreeLabelPanel(props){if(!__FreeLabelComponent){globalThis.__freeLabelReact=x;const React=x;${js}\n__FreeLabelComponent=FreeLabelModule.FreeLabelEditor;}return x.createElement(__FreeLabelComponent,props);}\n`;
 let entry=fs.readFileSync(path.join(work,'web-entry.js'),'utf8');const before=entry;
 function replace(a,b){assert.equal(entry.split(a).length,2,a);entry=entry.replace(a,b);}
 replace('function cF({session:t}){const[n,s]=x.useState(null);','function cF({session:t}){const[n,s]=x.useState(null);const __tabs=["wms.logoff.pro","77.37.144.211","192.168.0.45","localhost","127.0.0.1"].includes(location.hostname)?[...Uk,{id:"free",label:"Свободный ввод",icon:Js}]:Uk;');
 const start=entry.indexOf('function cF('),end=entry.indexOf('function dF(',start);let panel=entry.slice(start,end);assert.equal(panel.split('Uk.map(').length,3);panel=panel.replaceAll('Uk.map(','__tabs.map(');entry=entry.slice(0,start)+panel+entry.slice(end);
 replace('n==="jobs"?e.jsx(V6,{session:t}):null]}):null}','n==="jobs"?e.jsx(V6,{session:t}):null,n==="free"?e.jsx(__FreeLabelPanel,{session:t}):null]}):null}');
 replace('function dF(t){return','function dF(t){if(t==="free")return "Текст, счётчики и печать из файла.";return');
 assert(before!==entry);fs.writeFileSync(path.join(out,'assets/free-label-host-20261124.js'),wrapper+entry);
 fs.copyFileSync(path.join(root,'apps/web/src/components/print/free-label.css'),path.join(out,'assets/free-label-20261124.css'));
 const pdf=path.join(root,'apps/web/node_modules/pdfjs-dist/build');fs.copyFileSync(path.join(pdf,'pdf.mjs'),path.join(out,'assets/free-label-pdf-20261124.js'));fs.copyFileSync(path.join(pdf,'pdf.worker.min.mjs'),path.join(out,'assets/free-label-worker-20261124.js'));
 let html=fs.readFileSync(path.join(work,'index.html'),'utf8');assert(html.includes('/assets/returns-kiz-20261122.js'));html=html.replaceAll('/assets/returns-kiz-20261122.js','/assets/free-label-host-20261124.js').replace('</head>','<link rel="stylesheet" href="/assets/free-label-20261124.css"></head>');fs.writeFileSync(path.join(out,'index.html'),html);
 console.log('Exact web overlay: index + host + CSS + PDF module/worker');
})().catch(e=>{console.error(e);process.exitCode=1;});

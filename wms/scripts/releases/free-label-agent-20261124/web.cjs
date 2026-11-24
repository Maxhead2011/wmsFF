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
  b.onLoad({filter:/.*/,namespace:'api'},()=>({contents:`export async function fetchClients(token){const r=await fetch('/api/v1/clients',{headers:{Authorization:'Bearer '+token}});const d=await r.json();if(!r.ok)throw Error(d.message||'Clients unavailable');return d;}export async function fetchLabelTemplates(token){const r=await fetch('/api/v1/print/templates',{headers:{Authorization:'Bearer '+token}});const d=await r.json();if(!r.ok)throw Error(d.message||'Не удалось загрузить шаблоны');return d;}`,loader:'js'}));
  b.onResolve({filter:/^pdfjs-dist$/},()=>({path:'/assets/free-label-pdf-20261124.js',external:true}));
  b.onResolve({filter:/pdf\.worker.*\?url$/},()=>({path:'worker',namespace:'worker'}));
  b.onLoad({filter:/.*/,namespace:'worker'},()=>({contents:`export default '/assets/free-label-worker-20261124.js'`,loader:'js'}));
 }}]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
 // JSX transform needs an explicit React binding; actual hooks use the running app's React.
 const wrapper=`var __FreeLabelComponent;function __FreeLabelPanel(props){if(!__FreeLabelComponent){globalThis.__freeLabelReact=x;const React=x;${js}\n__FreeLabelComponent=FreeLabelModule.FreeLabelEditor;}return x.createElement(__FreeLabelComponent,props);}\n`;
 let entry=fs.readFileSync(path.join(work,'web-entry.js'),'utf8');
 const marker='return x.createElement(__FreeLabelComponent,props);}//END'.replace('//END','\n');
 assert.equal(entry.split(marker).length,2);assert(entry.startsWith('var __FreeLabelComponent;'));
 entry=wrapper+entry.slice(entry.indexOf(marker)+marker.length);
 fs.writeFileSync(path.join(out,'assets/free-label-agent-host-20261124.js'),entry);
 let html=fs.readFileSync(path.join(work,'index.html'),'utf8');assert(html.includes('/assets/free-label-host-20261124.js'));html=html.replaceAll('/assets/free-label-host-20261124.js','/assets/free-label-agent-host-20261124.js');fs.writeFileSync(path.join(out,'index.html'),html);
 console.log('Exact web overlay: index + host + CSS + PDF module/worker');
})().catch(e=>{console.error(e);process.exitCode=1;});

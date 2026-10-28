// FIX: new small workspace modules plus unique edits to deployed branch-aware FBS/WB/Ozon modules.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),src=path.resolve(__dirname,'../../../apps/web/src').replaceAll('\\','/'),assets=root+'/web/payload/assets',base=root+'/web-base';fs.mkdirSync(assets,{recursive:true});
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const name='lamoda-source-scan-20261028';
const plugin={name:'runtime',setup(b){
 b.onLoad({filter:/[/\\]fbs\.css$/},()=>({contents:'',loader:'css'}));
 b.onResolve({filter:/^(react|react\/jsx-runtime|react-dom)$/},a=>({path:a.path,namespace:'host'}));
 b.onLoad({filter:/.*/,namespace:'host'},a=>({contents:a.path==='react-dom'?'import{__FbyReactDOM as D}from"./admin-tiles-20261019-0.js";export const createPortal=(...a)=>D.createPortal(...a);':a.path==='react'?'import{r as R}from"./admin-tiles-20261019-0.js";export default R;'+['createContext','useState','useEffect','useRef','useMemo','useCallback','useContext','useId','useLayoutEffect','createElement','forwardRef','lazy','Suspense','Fragment'].map(n=>'export const '+n+'=R.'+n+';').join(''):'import{j as J}from"./admin-tiles-20261019-0.js";export const jsx=J.jsx,jsxs=J.jsxs,Fragment=J.Fragment;',loader:'js',resolveDir:assets}));
 b.onResolve({filter:/admin-tiles-20261019-0\.js$/},a=>({path:a.path,external:true}));
 b.onResolve({filter:/(ClientRequestsPanel|OzonFboPanel)$/},a=>({path:'./'+(a.path.endsWith('ClientRequestsPanel')?'admin-tiles-20261019-4.js':'admin-tiles-20261019-14.js'),external:true}));
}};
function change(s,a,b){assert.equal(s.split(a).length,2,a.slice(0,100));return s.replace(a,b)}
const mapping=[];
function save(old,next,s){fs.writeFileSync(assets+'/'+next,s);mapping.push([old,next]);}
(async()=>{
 const entry=`export {FboWorkspace} from '${src}/components/client-requests/FboWorkspace';export {LamodaPanel} from '${src}/components/lamoda/LamodaPanel';export {ClientLamodaConnections} from '${src}/components/client-cabinet/ClientLamodaConnections';export {visibleMarket,connected,workspaceClients,fetchWorkspaceClients} from '${src}/lib/marketplaceWorkspace';export {fetchClients} from '${src}/lib/api';`;
 const result=await esbuild.build({stdin:{contents:entry,resolveDir:src,loader:'tsx'},bundle:true,external:['/brand/*'],write:false,outfile:assets+'/'+name+'.js',format:'esm',jsx:'automatic',minify:true,define:{'import.meta.env':JSON.stringify({VITE_LAMODA_ENABLED:'true',VITE_YANDEX_FBY_ENABLED:'true',VITE_MARKETPLACE_WORKSPACES_ENABLED:'true'})},plugins:[plugin]});for(const f of result.outputFiles)fs.writeFileSync(f.path,f.contents);
 let html=fs.readFileSync(base+'/index.html','utf8');const m=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(m);const map=JSON.parse(m[1]);
 const previous=map.imports['/assets/admin-tiles-20261019-15.js'];assert(previous);for(const[k,v]of Object.entries(map.imports))if(v===previous)map.imports[k]='/assets/'+name+'.js';
 map.imports[previous]='/assets/'+name+'.js';
 html=html.replace(m[1],JSON.stringify(map)).replace('</head>','<link rel="stylesheet" href="/assets/'+name+'.css">\n</head>');
 fs.appendFileSync(assets+'/'+name+'.css','\n'+fs.readFileSync(src+'/components/layout/marketplace-surfaces.css','utf8'));
 fs.writeFileSync(root+'/web/payload/index.html',html);console.log('Inline assembly overlay built');
})().catch(e=>{console.error(e);process.exitCode=1});

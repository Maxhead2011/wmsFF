// FIX: preserve deployed React, marketplace panels and every unrelated runtime asset.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),src=path.resolve(__dirname,'../../../apps/web/src'),assets=root+'/web/payload/assets';fs.mkdirSync(assets,{recursive:true});
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const bridge=inline=>({name:'production-host',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime|react-dom)$/},a=>({path:a.path,namespace:'host'}));
 b.onLoad({filter:/.*/,namespace:'host'},a=>({contents:a.path==='react-dom'?'import{__FbyReactDOM as D}from"./admin-tiles-20261019-0.js";export const createPortal=(...args)=>D.createPortal(...args);':a.path==='react'?(inline?'const R=__FbyReact;':'import{r as R}from"./admin-tiles-20261019-0.js";')+'export default R;'+['useState','useEffect','useRef','useMemo','useCallback','useContext','useId','useLayoutEffect','createElement','forwardRef','lazy','Suspense','Fragment'].map(n=>'export const '+n+'=R.'+n+';').join(''):(inline?'const J=__FbyJsx;':'import{j as J}from"./admin-tiles-20261019-0.js";')+'export const jsx=J.jsx,jsxs=J.jsxs,Fragment=J.Fragment;',loader:'js',resolveDir:assets}));
 b.onResolve({filter:/admin-tiles-20261019-0\.js$/},a=>({path:a.path,external:true}));
 if(!inline)b.onResolve({filter:/(ClientRequestsPanel|OzonFboPanel|LamodaPanel)$/},a=>({path:'./'+({ClientRequestsPanel:'admin-tiles-20261019-4.js',OzonFboPanel:'admin-tiles-20261019-14.js',LamodaPanel:'lamoda-ui-20261026.js'})[a.path.split('/').pop()],external:true}));
}});
(async()=>{
 const result=await esbuild.build({entryPoints:[src+'/components/client-requests/FboWorkspace.tsx'],bundle:true,external:['/brand/*'],write:false,outfile:assets+'/marketplaces-fbo-20261028.js',format:'esm',jsx:'automatic',minify:true,define:{'import.meta.env':'{"VITE_LAMODA_ENABLED":"true","VITE_YANDEX_FBY_ENABLED":"true"}'},plugins:[bridge(false)]});for(const f of result.outputFiles)fs.writeFileSync(f.path,f.contents);
 const card=await esbuild.build({entryPoints:[src+'/components/client-cabinet/ClientLamodaConnections.tsx'],bundle:true,write:false,format:'iife',globalName:'__ClientLamoda',jsx:'automatic',minify:true,define:{'import.meta.env':'{}'},plugins:[bridge(true)]});
 let host=fs.readFileSync(root+'/web-base/assets/receipt-processing-host-20261027.js','utf8');
 function replace(a,b){assert.equal(host.split(a).length,2,a);host=host.replace(a,b)}
 replace('e.jsx(s$,{accessToken:t.accessToken,client:M.client})','e.jsxs(e.Fragment,{children:[e.jsx(s$,{accessToken:t.accessToken,client:M.client}),e.jsx(__ClientLamoda.ClientLamodaConnections,{session:t,clientId:M.client.id},M.client.id)]})');
 replace('API для FBS и карточек товаров','Кабинеты и подключения маркетплейсов');
 host+='\nconst __FbyReact=x,__FbyJsx=e;\n'+card.outputFiles[0].text+'\nexport{j5 as __FbyReactDOM};\n';
 fs.writeFileSync(assets+'/marketplaces-client-host-20261028.js',host);
 let wb=fs.readFileSync(root+'/web-base/assets/lamoda-wb-isolation-20261028.js','utf8');assert.equal(wb.split('!s.lamodaAssembly').length,2);wb=wb.replace('!s.lamodaAssembly','!s.lamodaAssembly&&!s.yandexFbyShipment');fs.writeFileSync(assets+'/marketplaces-wb-isolation-20261028.js',wb);
 let html=fs.readFileSync(root+'/web-base/index.html','utf8');const m=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(m);const map=JSON.parse(m[1]);
 for(const [old,next]of [['receipt-processing-host-20261027.js','marketplaces-client-host-20261028.js'],['lamoda-client-host-20261028.js','marketplaces-fbo-20261028.js'],['lamoda-wb-isolation-20261028.js','marketplaces-wb-isolation-20261028.js']]){for(const [k,v]of Object.entries(map.imports))if(v==='/assets/'+old)map.imports[k]='/assets/'+next;map.imports['/assets/'+old]='/assets/'+next;html=html.replaceAll('src="/assets/'+old+'"','src="/assets/'+next+'"');}
 html=html.replace(m[1],JSON.stringify(map)).replace('</head>','<link rel="stylesheet" href="/assets/marketplaces-fbo-20261028.css">\n</head>');fs.writeFileSync(root+'/web/payload/index.html',html);console.log('Marketplace web overlay ready');
})().catch(e=>{console.error(e);process.exitCode=1});

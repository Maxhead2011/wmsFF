// FIX: new small workspace modules plus unique edits to deployed branch-aware FBS/WB/Ozon modules.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),src=path.resolve(__dirname,'../../../apps/web/src').replaceAll('\\','/'),assets=root+'/web/payload/assets',base=root+'/web-base';fs.mkdirSync(assets,{recursive:true});
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const name='workspace-ui-20261028';
const plugin={name:'runtime',setup(b){
 b.onLoad({filter:/[/\\]fbs\.css$/},()=>({contents:'',loader:'css'}));
 b.onResolve({filter:/^(react|react\/jsx-runtime|react-dom)$/},a=>({path:a.path,namespace:'host'}));
 b.onLoad({filter:/.*/,namespace:'host'},a=>({contents:a.path==='react-dom'?'import{__FbyReactDOM as D}from"./admin-tiles-20261019-0.js";export const createPortal=(...a)=>D.createPortal(...a);':a.path==='react'?'import{r as R}from"./admin-tiles-20261019-0.js";export default R;'+['useState','useEffect','useRef','useMemo','useCallback','useContext','useId','useLayoutEffect','createElement','forwardRef','lazy','Suspense','Fragment'].map(n=>'export const '+n+'=R.'+n+';').join(''):'import{j as J}from"./admin-tiles-20261019-0.js";export const jsx=J.jsx,jsxs=J.jsxs,Fragment=J.Fragment;',loader:'js',resolveDir:assets}));
 b.onResolve({filter:/admin-tiles-20261019-0\.js$/},a=>({path:a.path,external:true}));
 b.onResolve({filter:/(ClientRequestsPanel|OzonFboPanel)$/},a=>({path:'./'+(a.path.endsWith('ClientRequestsPanel')?'admin-tiles-20261019-4.js':'admin-tiles-20261019-14.js'),external:true}));
}};
function change(s,a,b){assert.equal(s.split(a).length,2,a.slice(0,100));return s.replace(a,b)}
const mapping=[];
function save(old,next,s){fs.writeFileSync(assets+'/'+next,s);mapping.push([old,next]);}
(async()=>{
 const entry=`export {FboWorkspace} from '${src}/components/client-requests/FboWorkspace';export {LamodaPanel} from '${src}/components/lamoda/LamodaPanel';export {ClientLamodaConnections} from '${src}/components/client-cabinet/ClientLamodaConnections';export {visibleMarket,connected,workspaceClients,fetchWorkspaceClients} from '${src}/lib/marketplaceWorkspace';export {fetchClients} from '${src}/lib/api';`;
 const result=await esbuild.build({stdin:{contents:entry,resolveDir:src,loader:'tsx'},bundle:true,external:['/brand/*'],write:false,outfile:assets+'/'+name+'.js',format:'esm',jsx:'automatic',minify:true,define:{'import.meta.env':JSON.stringify({VITE_LAMODA_ENABLED:'true',VITE_YANDEX_FBY_ENABLED:'true',VITE_MARKETPLACE_WORKSPACES_ENABLED:'true'})},plugins:[plugin]});for(const f of result.outputFiles)fs.writeFileSync(f.path,f.contents);
 let host=fs.readFileSync(base+'/assets/marketplaces-client-host-20261028.js','utf8');
 // Replace the old isolated card export reference, leaving the complete host and its prior fixes intact.
 // Load after host initialization: a static import here would create a React export cycle.
 host=change(host,'e.jsx(__ClientLamoda.ClientLamodaConnections,','e.jsx(__WorkspaceCard,');
 host+='\nfunction __WorkspaceCard(props){const [M,setM]=x.useState(null);x.useEffect(()=>{let live=true;import("./'+name+'.js").then(m=>{if(live)setM(()=>m.ClientLamodaConnections)});return()=>{live=false}},[]);return M?e.jsx(M,props):e.jsx("p",{children:"Загрузка кабинетов Lamoda…"})}\n';
 save('marketplaces-client-host-20261028.js','workspace-main-20261028.js',host);
 let wb=fs.readFileSync(base+'/assets/marketplaces-wb-isolation-20261028.js','utf8');
 wb=change(wb,'Ka(t.accessToken),Ha(t.accessToken)', '(s?__MW.fetchWorkspaceClients(t.accessToken,"WILDBERRIES"):Ka(t.accessToken)),Ha(t.accessToken)');
 save('marketplaces-wb-isolation-20261028.js','workspace-wb-20261028.js','import * as __MW from "./'+name+'.js";\n'+wb);
 let oz=fs.readFileSync(base+'/assets/ozon-deadline-host-20261026.js','utf8');
 oz=change(oz,'Ge(s.accessToken).then(n=>{f(n);','__MW.fetchWorkspaceClients(s.accessToken,"OZON").then(n=>{f(n);');
 oz=change(oz,'re(s.accessToken).then(l=>{if(!o)return;','__MW.fetchWorkspaceClients(s.accessToken,"OZON").then(l=>{if(!o)return;');
 save('ozon-deadline-host-20261026.js','workspace-ozon-20261028.js','import * as __MW from "./'+name+'.js";\n'+oz);
 let fbs=fs.readFileSync(base+'/assets/multishop-auto-host-20261026.js','utf8');
 fbs=change(fbs,'xr(s.accessToken,{allBranches:d,displayWarehouseId:u}).then(y=>{','__MW.fetchClients(s.accessToken,{marketplaceDirectory:true,allBranches:d,displayWarehouseId:u}).then(rows=>{const y=a?__MW.workspaceClients(rows,a,"fbs"):rows;');
 // The production wrapper retains per-marketplace branch selection and remounts the child on switching.
 fbs=change(fbs,'c.createElement(ci,{...s,key:', 't==="LAMODA"?e.jsxs("section",{children:[e.jsx("button",{onClick:()=>a(null),children:"Назад к площадкам FBS"}),e.jsx(__MW.LamodaPanel,{session:s.session,mode:"fbs"})]}):c.createElement(ci,{...s,key:');
 for(const [kind,market]of [['wb','WILDBERRIES'],['ozon','OZON'],['yandex','YANDEX_MARKET']])fbs=change(fbs,'e.jsxs("button",{type:"button",className:"fbs-marketplace-card fbs-marketplace-card--'+kind+'"','__MW.visibleMarket(s,W,"'+market+'","fbs")&&e.jsxs("button",{type:"button",className:"fbs-marketplace-card fbs-marketplace-card--'+kind+'"');
 fbs=change(fbs,'__MW.visibleMarket(s,W,"YANDEX_MARKET","fbs")&&','__MW.visibleMarket(s,W,"LAMODA","fbs")&&e.jsxs("button",{className:"fbs-marketplace-card fbs-marketplace-card--lamoda",onClick:()=>r("LAMODA"),children:[e.jsx("span",{className:"fbs-marketplace-card__brand",children:e.jsx("img",{src:"/brand/lamoda.jpg",alt:""})}),e.jsxs("span",{className:"fbs-marketplace-card__content",children:[e.jsx("strong",{children:"FBS Lamoda"}),e.jsx("p",{children:"Заказы и статусы отгрузок Lamoda"})]})]}),__MW.visibleMarket(s,W,"YANDEX_MARKET","fbs")&&');
 fbs=change(fbs,'className:"fbs-marketplace-picker"','className:"fbs-marketplace-picker fbs-marketplace-picker--four"');
 fbs=change(fbs,'children:"3 рабочих контура"','children:"4 рабочих контура"');
 fbs=change(fbs,'Заказы и инструменты Wildberries, Ozon и Яндекс Маркета','Заказы и инструменты Wildberries, Ozon, Lamoda и Яндекс Маркета');
 fbs=change(fbs,'for(const E of ni)try{const G=i[E]','for(const E of ni)try{if(!__MW.visibleMarket(s,W,E,"fbs"))continue;const G=i[E]');
 fbs=change(fbs,'R(Object.fromEntries(y))},[s.accessToken,i])','R({...ai,...Object.fromEntries(y)})},[s.accessToken,i,W])');
 const connect=fbs.match(/function Ci\([^]*?\)\{return s\?/);assert(connect);
 fbs=change(fbs,connect[0],connect[0].replace('{return s?','{return e.jsx("p",{children:"Подключение настраивается в карточке клиента → Кабинеты и подключения маркетплейсов."});return s?'));
 save('multishop-auto-host-20261026.js','workspace-fbs-20261028.js','import * as __MW from "./'+name+'.js";\n'+fbs);
 mapping.push(['marketplaces-fbo-20261028.js',name+'.js'],['lamoda-mapping-ui-20261028.js',name+'.js']);
 let html=fs.readFileSync(base+'/index.html','utf8'),m=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(m);const map=JSON.parse(m[1]);
 for(const[old,next]of mapping){for(const[k,v]of Object.entries(map.imports))if(v==='/assets/'+old)map.imports[k]='/assets/'+next;map.imports['/assets/'+old]='/assets/'+next;html=html.replaceAll('src="/assets/'+old+'"','src="/assets/'+next+'"');}
 html=html.replace(m[1],JSON.stringify(map)).replace('</head>','<link rel="stylesheet" href="/assets/'+name+'.css">\n</head>');fs.writeFileSync(root+'/web/payload/index.html',html);
 // Retain the production FBS column layout except the new four-tile picker.
 fs.appendFileSync(assets+'/'+name+'.css','\n'+fs.readFileSync(src+'/components/fbs/fbs.css','utf8').split('/* FIX: four independent operational marketplaces')[1].replace(/^.*?\*\//s,''));
 fs.appendFileSync(assets+'/'+name+'.css','\n'+fs.readFileSync(src+'/components/layout/marketplace-surfaces.css','utf8'));
 console.log('Exact marketplace overlay built');
})().catch(e=>{console.error(e);process.exitCode=1});

// FIX: additive overlays preserve the complete published web graph.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root=path.resolve(process.argv[2]),src=path.resolve(__dirname,'../../../apps/web/src');
(async()=>{
 let html=fs.readFileSync(root+'/web-base/index.html','utf8');const im=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(im[1]),outputs={};
 function patch(file,fn){const before=fs.readFileSync(root+'/web-base/assets/'+file,'utf8');const after=fn(before);assert.notEqual(before,after);assert.equal(ts.createSourceFile(file,after,99,true).parseDiagnostics.length,0);const next='/assets/client-stores-'+file;outputs[next]=after;for(const key of Object.keys(map.imports))if(map.imports[key]==='/assets/'+file)map.imports[key]=next;map.imports['/assets/'+file]=next;html=html.replace(`src="/assets/${file}"`,`src="${next}"`);}
 function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b);}
 const api=fs.readFileSync(src+'/lib/api.ts','utf8').split('\n').filter(l=>/^export function (fetchClientStores|saveClientStores|fetchSkuStores|saveSkuStores)\(/.test(l)).join('\n')+'\nexport const fetchSkus=(accessToken,filter)=>request("/skus?"+new URLSearchParams(filter),{accessToken});';
 const shims={react:'export const useState=(...a)=>x.useState(...a),useEffect=(...a)=>x.useEffect(...a),useRef=(...a)=>x.useRef(...a);','react/jsx-runtime':'export const jsx=(...a)=>e.jsx(...a),jsxs=(...a)=>e.jsxs(...a),Fragment=e.Fragment;',api:'const request=z;'+api};
 const build=await esbuild.build({stdin:{contents:'export {ClientStoresSettings} from "./components/client-cabinet/ClientStoresSettings";',resolveDir:src,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__ClientStores',jsx:'automatic',minify:true,plugins:[{name:'reuse-live',setup(b){b.onResolve({filter:/^react(?:\/jsx-runtime)?$/},a=>({path:a.path,namespace:'live'}));b.onResolve({filter:/\/lib\/api$/},()=>({path:'api',namespace:'live'}));b.onLoad({filter:/.*/,namespace:'live'},a=>({contents:shims[a.path],loader:'ts'}));}}]});
 patch('sidebar-counts-core-20261030.js',s=>once(s,'e.jsx(j$,{accessToken:t.accessToken,clientId:M.client.id})','t.user.roleCodes.some(role=>role==="ADMIN"||role==="OWNER")&&e.jsx(__ClientStores.ClientStoresSettings,{accessToken:t.accessToken,clientId:M.client.id},"stores:"+M.client.id),e.jsx(j$,{accessToken:t.accessToken,clientId:M.client.id})')+'\n'+build.outputFiles[0].text);
 patch('workspace-fbs-20261028.js',s=>{
  s=once(s,'function ki({data:s,','function __ClientStoresOriginalTable({data:s,');
  // Store changes clear selection; all original delivery, branch and action props survive.
  return s+`\nfunction ki(props){const [selected,setSelected]=c.useState('all');const data=props.data,stores=data?.stores??[],scope=(data?.connections??[]).map(v=>v.id).sort().join('|');c.useEffect(()=>{setSelected('all');},[scope]);if(!stores.length)return e.jsx(__ClientStoresOriginalTable,props);const current=selected==='all'||selected==='unassigned'||stores.some(s=>s.id===selected)?selected:'all';const known=new Set(stores.flatMap(s=>s.connectionIds)),ids=new Set(stores.find(s=>s.id===current)?.connectionIds??[]);const orders=current==='all'?data.orders:data.orders.filter(o=>current==='unassigned'?!known.has(o.connectionId):ids.has(o.connectionId));return e.jsxs(e.Fragment,{children:[e.jsx('nav',{'aria-label':'Магазины',className:'fbs-view-tabs',children:[{id:'all',name:'Все магазины'},...stores,{id:'unassigned',name:'Не определён'}].map(s=>e.jsx('button',{type:'button','aria-pressed':s.id===current,className:s.id===current?'is-active':'',onClick:()=>{setSelected(s.id);props.onSelectionChange(new Set());},children:s.name},s.id))}),e.jsx(__ClientStoresOriginalTable,{...props,data:{...data,orders}})]});}\n`;
 });
 patch('fbo-progress-wb-20261030.js',s=>once(s,'e.jsxs("span",{className:"client-request-list-meta",children:[_a(c.type)','c.storeState&&e.jsxs("span",{children:["Магазин: ",c.storeState==="UNASSIGNED"?"не определён":c.storeNames?.join(", "),c.storeState==="MIXED"?" · требуется разделение заявки":""]}),e.jsxs("span",{className:"client-request-list-meta",children:[_a(c.type)'));
 patch('invoice-download-names-20261021-23.js',s=>once(s,'children:h.description}),e.jsx("span",{children:((P=h.request)','children:h.description}),h.storeState&&e.jsxs("span",{children:["Магазин: ",h.storeState==="UNASSIGNED"?"не определён":h.storeNames?.join(", ")]}),e.jsx("span",{children:((P=h.request)'));
 html=html.replace(im[1],JSON.stringify(map));
 // FIX: import maps do not rewrite the HTML module entry; loading the old entry
 // beside the mapped core starts two React applications on the same root.
 const entry=html.match(/<script type="module" crossorigin src="([^"]+)"/);assert(entry);
 html=html.replace(`src="${entry[1]}"`,'src="/assets/client-stores-sidebar-counts-core-20261030.js"');
 outputs['/index.html']=html;
 for(const [name,s] of Object.entries(outputs)){const p=root+'/web-payload'+name;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
 fs.writeFileSync(root+'/web-proof.json',JSON.stringify({files:Object.keys(outputs),preservesRuntime:true}));console.log('Prepared',Object.keys(outputs).length,'web files');
})().catch(e=>{console.error(e);process.exit(1)});

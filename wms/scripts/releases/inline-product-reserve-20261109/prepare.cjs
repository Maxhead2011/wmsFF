// FIX: exact overlay on published FBS; React comes from its existing runtime singleton.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{createRequire}=require('module');
const root=path.resolve(process.argv[2]),web=path.resolve('apps/web'),req=createRequire(require.resolve('vite',{paths:[web+'/node_modules']})),esbuild=req('esbuild');
(async()=>{
 const old='assets/wb-document-actions-20261108.js',next='assets/inline-reserve-fbs-20261109.js',editor='assets/inline-product-reserve-20261109.js',css='assets/inline-product-reserve-20261109.css';
 const base=fs.readFileSync(root+'/web-base/'+old,'utf8');let s=base;const edits=[];
 function replace(a,b){assert.equal(s.split(a).length,2);s=s.replace(a,b);edits.push([a,b]);}
 replace('Be=c.useCallback(async(b,M,z=!1)=>','Be=c.useCallback(async(b,M,z=!1,__keepPage=false)=>');
 replace('return n({status:"ready",data:q,error:""}),$(0),q','return n({status:"ready",data:q,error:""}),(__keepPage?void 0:$(0)),q');
 const anchor='b.relabeling.allocatedToTargets.toLocaleString("ru-RU")," шт."]}):null]}),e.jsxs("td",{children:[e.jsx("strong",{children:b.barcode';
 replace(anchor,'b.relabeling.allocatedToTargets.toLocaleString("ru-RU")," шт."]}):null,e.jsx(__InlineProductReserve,{session:t,clientId:s,connectionId:r.data.selectedConnectionId||"",skuId:b.skuId,onSaved:()=>Be(r.data.selectedConnectionId,r.data.selectedWarehouseId,false,true)},`${s}:${r.data.selectedConnectionId}:${b.skuId}`)]}),e.jsxs("td",{children:[e.jsx("strong",{children:b.barcode');
 let inverse=s;for(const[a,b]of [...edits].reverse())inverse=inverse.replace(b,a);assert.equal(inverse,base);
 s='import {FbsProductReserve as __InlineProductReserve} from "./inline-product-reserve-20261109.js";\n'+s;
 const built=await esbuild.build({entryPoints:[web+'/src/components/fbs/FbsProductReserve.tsx'],bundle:true,write:false,format:'esm',define:{'import.meta.env.VITE_API_URL':'"/api/v1"'},plugins:[{name:'published-react',setup(build){build.onResolve({filter:/^react$/},()=>({path:'published-react',namespace:'singleton'}));build.onLoad({filter:/.*/,namespace:'singleton'},()=>({contents:'import {r as React} from "./admin-tiles-20261019-0.js";export default React;export const useEffect=React.useEffect,useRef=React.useRef,useState=React.useState;',loader:'js'}));build.onResolve({filter:/admin-tiles-20261019-0.js/},()=>({path:'./admin-tiles-20261019-0.js',external:true}));}}]});
 const put=(n,v)=>{fs.mkdirSync(path.dirname(root+'/web-payload/'+n),{recursive:true});fs.writeFileSync(root+'/web-payload/'+n,v)};
 put(next,s);put(editor,built.outputFiles[0].text);
 const styles=fs.readFileSync(web+'/src/components/fbs/fbs.css','utf8').split('/* FIX: keep per-position safety settings within the product cell in both themes. */')[1];assert(styles);put(css,styles);
 let html=fs.readFileSync(root+'/web-base/index.html','utf8');const m=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(m[1]);let count=0;
 for(const key of Object.keys(map.imports))if(map.imports[key]==='/'+old){map.imports[key]='/'+next;count++}assert(count);map.imports['/'+old]='/'+next;html=html.replace(m[1],()=>JSON.stringify(map));assert(!html.includes(css));html=html.replace('</head>','<link rel="stylesheet" href="/'+css+'">\n</head>');put('index.html',html);
 fs.writeFileSync(root+'/web-changes.json',JSON.stringify([next,editor,css,'index.html']));fs.writeFileSync(root+'/overlay-proof.json',JSON.stringify({files:4,existingFbsBytesPreserved:true,reactSingleton:true,preservePage:true}));console.log('Web4 ready; original FBS inverse proof verified');
})().catch(e=>{console.error(e);process.exitCode=1});

// FIX: isolated Lamoda UI bundle with deployed React; preserve other marketplace chunks.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=process.argv[2],src=path.resolve(__dirname,'../../../apps/web/src'),assets=root+'/web/payload/assets';fs.mkdirSync(assets,{recursive:true});
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
(async()=>{const name='lamoda-mapping-ui-20261028',result=await esbuild.build({entryPoints:[src+'/components/lamoda/LamodaPanel.tsx'],bundle:true,external:['/brand/*'],write:false,outfile:assets+'/'+name+'.js',format:'esm',jsx:'automatic',minify:true,define:{'import.meta.env':'{}'},plugins:[{name:'react-host',setup(b){
b.onResolve({filter:/^react(\/jsx-runtime)?$/},a=>({path:a.path,namespace:'host'}));b.onLoad({filter:/.*/,namespace:'host'},a=>({contents:a.path==='react'?'import{r as R}from"./admin-tiles-20261019-0.js";export default R;export const useState=R.useState,useEffect=R.useEffect,useRef=R.useRef,useMemo=R.useMemo,useCallback=R.useCallback;':'import{j as J}from"./admin-tiles-20261019-0.js";export const jsx=J.jsx,jsxs=J.jsxs,Fragment=J.Fragment;',loader:'js',resolveDir:assets}));b.onResolve({filter:/admin-tiles-20261019-0\.js$/},a=>({path:a.path,external:true}));}}]});
for(const f of result.outputFiles)fs.writeFileSync(f.path,f.contents);
let html=fs.readFileSync(root+'/web-base/index.html','utf8');const m=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(m);const map=JSON.parse(m[1]);map.imports['/assets/lamoda-ui-20261026.js']='/assets/'+name+'.js';map.imports['/assets/lamoda-client-ui-20261028.js']='/assets/'+name+'.js';
html=html.replace(m[1],JSON.stringify(map)).replace('</head>','<link rel="stylesheet" href="/assets/'+name+'.css">\n</head>');fs.writeFileSync(root+'/web/payload/index.html',html);
console.log('Lamoda UI and WB isolation overlay built');})().catch(e=>{console.error(e);process.exitCode=1});


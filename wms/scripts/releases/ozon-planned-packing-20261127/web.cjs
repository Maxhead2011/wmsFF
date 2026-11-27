// FIX: additive planned-flow bundle; retain every existing non-planned screen and import.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const wms=path.resolve(__dirname,'../../..'),r=process.argv[2],out=path.join(r,'web');
const esbuild=require('module').createRequire(require.resolve(path.join(wms,'apps/web/node_modules/vite/package.json')))('esbuild');
(async()=>{
fs.mkdirSync(path.join(out,'assets'),{recursive:true});
const input=`import React,{useState,useEffect} from 'react';
import {FboTwoStagePanel} from './components/client-requests/FboTwoStagePanel';
import {OzonAssemblySupply} from './components/ozon-fbo/OzonAssemblySupply';
import {OzonPackingPlan} from './components/ozon-fbo/OzonPackingPlan';
import {ozonAssemblySupply} from './lib/api';
export {FboTwoStagePanel};
export function PlannedSupplyGate(props){const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
useEffect(()=>{let live=true;ozonAssemblySupply(props.accessToken,props.requestId).then(d=>{if(live)setData(d)}).catch(()=>{});return()=>{live=false}},[props.accessToken,props.requestId]);
if(data?.link?.packingPlan)return React.createElement(OzonAssemblySupply,props);
const action=async(name,body)=>{setBusy(true);setError('');try{setData(await ozonAssemblySupply(props.accessToken,props.requestId,name,body))}catch(e){setError(e.message)}finally{setBusy(false)}};
return React.createElement(React.Fragment,null,React.createElement(props.Legacy,props),error&&React.createElement('p',{role:'alert'},error),data?.plannedPackingSupported&&!props.bindingOnly&&React.createElement(OzonPackingPlan,{data,busy,action}));}`;
const result=await esbuild.build({stdin:{contents:input,resolveDir:path.join(wms,'apps/web/src'),sourcefile:'planned-release.tsx',loader:'tsx'},bundle:true,write:false,outfile:path.join(out,'assets/ozon-planned-components-20261127.js'),format:'esm',jsx:'automatic',target:'es2022',define:{'import.meta.env':'{}'},plugins:[{name:'published-react',setup(b){
b.onResolve({filter:/^react(?:\/jsx-runtime)?$/},a=>({path:a.path,namespace:'host'}));
b.onLoad({filter:/.*/,namespace:'host'},a=>({contents:a.path==='react'?'import{r as R}from"/assets/admin-tiles-20261019-0.js";export default R;export const {useState,useEffect,useRef,useMemo,useCallback,createElement,Fragment}=R;':'import{j as J}from"/assets/admin-tiles-20261019-0.js";export const {jsx,jsxs,Fragment}=J;',loader:'js'}));
b.onResolve({filter:/^\/(?:assets|brand)\//},a=>({path:a.path,external:true}));
}}]});
for(const f of result.outputFiles)fs.writeFileSync(f.path,f.contents);
let html=fs.readFileSync(path.join(r,'index.html'),'utf8');const m=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(m);const map=JSON.parse(m[1]);
const replacements=[['fbo-pick-breakdown-20261126.js','ozon-planned-requests-20261127.js',['OzonAssemblySupply']],['ozon-zone-label-workspace-266.js','ozon-planned-workspace-20261127.js',['be','Z']]];
for(const [old,next,names] of replacements){let s=fs.readFileSync(path.join(r,old),'utf8');
s='import{FboTwoStagePanel as __PlannedPanel,PlannedSupplyGate as __PlannedSupplyGate}from"/assets/ozon-planned-components-20261127.js";\n'+s;
if(old.startsWith('fbo-')){const needle='function Bi(props){return e.jsx(';assert.equal(s.split(needle).length,2);s=s.replace(needle,'function Bi(props){if(props.initial.plannedPackingRequired)return e.jsx(__PlannedPanel,props);return e.jsx(');}
for(const name of names){const needle='function '+name+'({';assert.equal(s.split(needle).length,2);s=s.replace(needle,'function '+name+'(props){return __PlannedSupplyGate({...props,Legacy:__plannedLegacy_'+name+'});}\nfunction __plannedLegacy_'+name+'({');}
fs.writeFileSync(path.join(out,'assets',next),s);for(const key of Object.keys(map.imports))if(map.imports[key]==='/assets/'+old)map.imports[key]='/assets/'+next;map.imports['/assets/'+old]='/assets/'+next;
}
html=html.replace(m[1],JSON.stringify(map)).replace('</head>','<link rel="stylesheet" href="/assets/ozon-planned-components-20261127.css"></head>');fs.writeFileSync(path.join(out,'index.html'),html);
const changes=fs.readdirSync(path.join(out,'assets')).map(n=>'assets/'+n).concat('index.html');fs.writeFileSync(path.join(r,'web-changes.json'),JSON.stringify(changes));console.log(changes);
})().catch(e=>{console.error(e);process.exitCode=1});

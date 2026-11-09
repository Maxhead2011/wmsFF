// FIX: exact dialog replacement in the published FBS module; preserve all other controls.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const ts=require('../../../node_modules/typescript'),root=path.resolve(process.argv[2]),web=path.resolve('apps/web');
const req=createRequire(require.resolve('vite',{paths:[web+'/node_modules']}));
const old='assets/fbs-reserve-settings-20261109.js',next='assets/wb-shipping-fbs-20261109.js',dialog='assets/wb-shipping-dialog-20261109.js';
const original=fs.readFileSync(root+'/web-base/'+old,'utf8'),ast=ts.createSourceFile('fbs.js',original,99,true);
let target;function walk(n){if(ts.isFunctionDeclaration(n)&&n.getText(ast).includes('id:"fbs-supply-delivery-title"')){assert(!target);target=n;}ts.forEachChild(n,walk)}walk(ast);assert.equal(target.name.text,'gi');
(async()=>{
 const inject=root+'/react-inject.js';fs.writeFileSync(inject,'import React from "react";export {React};');
 const result=await req('esbuild').build({entryPoints:[web+'/src/components/fbs/FbsSupplyDeliveryDialog.tsx'],bundle:true,write:false,format:'esm',minify:true,inject:[inject],
  tsconfigRaw:{compilerOptions:{jsx:'react'}},jsx:'transform',jsxFactory:'React.createElement',jsxFragment:'React.Fragment',define:{'import.meta.env.VITE_API_URL':'"/api/v1"'},plugins:[{name:'published-react',setup(b){
   b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'shared'}));
   b.onLoad({filter:/.*/,namespace:'shared'},()=>({contents:'import {r as R} from "./admin-tiles-20261019-0.js";export default {createElement:(...a)=>R.createElement(...a),get Fragment(){return R.Fragment}};export const useState=(...a)=>R.useState(...a);',loader:'js'}));
   b.onResolve({filter:/admin-tiles-20261019-0.js/},()=>({path:'./admin-tiles-20261019-0.js',external:true}));
   b.onResolve({filter:/^lucide-react$/},()=>({path:'icons',namespace:'icons'}));
   b.onLoad({filter:/.*/,namespace:'icons'},()=>({contents:'import React from "react";export const Send=({size=23,...props})=>React.createElement("svg",{...props,width:size,height:size,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2},React.createElement("path",{d:"m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"}));',loader:'js'}));
  }}]});
 const code=result.outputFiles[0].text;assert(!code.includes('ReactCurrentDispatcher'));
 const before='gi,{state:Ge,isSubmitting:',after='gi,{accessToken:s.accessToken,clientId:f,state:Ge,isSubmitting:';
 assert.equal(original.split(before).length,2);
 const oldFunction=target.getText(ast),wrapper='function gi(props){return e.jsx(__WbShippingDialog,props)}';
 let patched=original.slice(0,target.getStart(ast))+wrapper+original.slice(target.end);patched=patched.replace(before,after);
 assert.equal(patched.replace(after,before).replace(wrapper,oldFunction),original,'inverse preserves unrelated UI bytes');
 patched='import {FbsSupplyDeliveryDialog as __WbShippingDialog} from "./wb-shipping-dialog-20261109.js";\n'+patched;
 assert.equal(ts.createSourceFile('new.js',patched,99,true).parseDiagnostics.length,0);
 const put=(name,value)=>{const p=root+'/web-payload/'+name;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value)};
 put(next,patched);put(dialog,code);
 const html=fs.readFileSync(root+'/web-base/index.html','utf8'),match=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(match[1]);let count=0;
 for(const key of Object.keys(map.imports))if(map.imports[key]==='/'+old){map.imports[key]='/'+next;count++}assert(count);map.imports['/'+old]='/'+next;
 put('index.html',html.replace(match[1],()=>JSON.stringify(map)));
 fs.writeFileSync(root+'/web-changes.json',JSON.stringify([next,dialog,'index.html']));
 console.log('Web3 exact dialog/props delta; all other FBS bytes retained; shared React/classic JSX');
})().catch(e=>{console.error(e);process.exitCode=1});

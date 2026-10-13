// FIX: preserve the complete pinned graph and replace only the review card and confirmation text.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const esbuild=require('module').createRequire(require.resolve('../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('./single-react-graph.cjs');
const root=process.argv[2],input=path.join(root,'web-base'),cache={};
const files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];
let s=files['assets/'+entry];assert(s.includes('var __MainFeatures=')&&s.includes('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED'));
const src=fs.readFileSync(path.join(__dirname,'../apps/web/src/components/kiz/KizReviewCard.tsx'),'utf8').replace(/^import .*;\r?\n/gm,'');
s+='\n'+esbuild.buildSync({stdin:{contents:'const React=__WmsReact;\n'+src,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__PhysicalKizCard',minify:true,jsxFactory:'React.createElement'}).outputFiles[0].text;
s+='\n__MainFeatures={...__MainFeatures,KizReviewCard:__PhysicalKizCard.KizReviewCard};\n';
const anchor='e.jsxs("p",{children:["КИЗ: ",g.row.kizIdentity]}),';
assert.equal(s.split(anchor).length,2);
s=s.replace(anchor,anchor+'g.resolution==="REUSE"&&g.row.physicalReuseAllowed&&e.jsx("p",{children:"Подтвердите именно эту физическую единицу. Прежняя привязка останется в истории как спорная; разрешение действует только для этого задания."}),');
cache['assets/'+entry]=s;
const result=repair(files,entry,entry,'kiz-physical-20261013');
for(const[n,data]of Object.entries(result)){const p=path.join(root,'web',n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(Object.keys(result)));

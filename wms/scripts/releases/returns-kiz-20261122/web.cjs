const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../../..'),work=process.argv[2];
const esbuild=require(path.join(root,'node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild'));
let source=fs.readFileSync(path.join(root,'apps/web/src/components/returns/ReturnsPanel.tsx'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function ReturnsPanel','function ReturnsPanel').replaceAll("import.meta.env.VITE_API_URL",'"/api/v1"');
const compiled=esbuild.transformSync(source,{loader:'tsx',jsxFactory:'x.createElement',jsxFragment:'x.Fragment',target:'es2020'}).code;
let entry=fs.readFileSync(path.join(work,'web-entry.js'),'utf8');
function replace(old,value){if(entry.split(old).length!==2)throw Error('Expected one occurrence: '+old);entry=entry.replace(old,value);}
const wrapper=`var __ReturnsComponent20261122;function __ReturnsPanel20261122(props){if(!__ReturnsComponent20261122){const {useState,useEffect,useRef}=x;
async function request(url,options={}){const r=await fetch('/api/v1'+url,{method:options.method||'GET',headers:{Authorization:'Bearer '+options.accessToken,'Content-Type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.message||'Ошибка загрузки');return data;}
function fetchClients(token){return request('/clients',{accessToken:token});}
${compiled}
__ReturnsComponent20261122=ReturnsPanel;}return x.createElement(__ReturnsComponent20261122,props);}\n`;
const oldEnd='}return x.createElement(__ReturnsComponent20261122,props);}'+'\n';
const cut=entry.indexOf(oldEnd);if(cut<0)throw Error('Published returns wrapper absent');entry=entry.slice(cut+oldEnd.length);
entry=wrapper+entry;
const output=path.join(work,'web');fs.mkdirSync(path.join(output,'assets'),{recursive:true});
fs.writeFileSync(path.join(output,'assets/returns-kiz-20261122.js'),entry);
fs.copyFileSync(path.join(root,'apps/web/src/components/returns/returns.css'),path.join(output,'assets/returns-kiz-20261122.css'));
let index=fs.readFileSync(path.join(work,'index.html'),'utf8');index=index.replaceAll('/assets/returns-20261122.js','/assets/returns-kiz-20261122.js').replace('</head>','<link rel="stylesheet" href="/assets/returns-kiz-20261122.css"></head>');fs.writeFileSync(path.join(output,'index.html'),index);
console.log('Built exact web overlay');

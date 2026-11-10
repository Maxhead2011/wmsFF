// FIX: scoped own-runtime overlay with inverse and source-token checks.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),cp=require('child_process');
const repo=process.cwd(),r=process.argv[2],ts=require(repo+'/wms/node_modules/typescript'),esbuild=require(repo+'/wms/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild');
const read=p=>fs.readFileSync(p,'utf8'),save=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
fs.cpSync(r+'/api-base',r+'/api-candidate',{recursive:true});
cp.execFileSync(process.execPath,[repo+'/wms/scripts/releases/market-status-open-20261110/prepare.cjs',r+'/api-candidate'],{stdio:'inherit'});
const api=['modules/client-requests/request-market-status.service.js','modules/client-requests/request-market-status-scheduler.service.js','modules/marketplace-connections/wb-packed-auto-done.js','modules/marketplace-connections/ozon-packed-auto-done.js'];
for(const f of api)save(r+'/api-payload/'+f,read(r+'/api-candidate/'+f));save(r+'/api-changes.json',JSON.stringify(api));
let html=read(r+'/web-base/index.html'),m=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(m[1]),old=map.imports['/assets/admin-tiles-20261019-4.js'],next='/assets/market-status-open-20261110.js';
const base=read(r+'/web-base'+old),a='o.createElement(__MarketButtons.MarketStatusBatch,';assert.equal(base.split(a).length,2);
const ast=ts.createSourceFile('batch.tsx',read(repo+'/wms/apps/web/src/components/client-requests/MarketStatusBatch.tsx'),99,true,ts.ScriptKind.TSX);
const batch=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n');
const prelude=`const React={get Fragment(){return o.Fragment},createElement:(...a)=>o.createElement(...a)};
const useState=(...a)=>o.useState(...a),useRef=(...a)=>o.useRef(...a),useEffect=(...a)=>o.useEffect(...a);
const RefreshCw=()=>o.createElement('span',{'aria-hidden':true},'↻');const requestStatusLabel=s=>bn(s);
async function remote(token,path,method){const res=await fetch('/api/v1/client-requests/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});const data=await res.json();if(!res.ok)throw Error(data.message||'Ошибка проверки статуса');return data;}
const marketStatusTargets=t=>remote(t,'market-status/targets','GET'),checkRequestMarketStatus=(t,id)=>remote(t,encodeURIComponent(id)+'/market-status','POST');\n`;
const add=esbuild.buildSync({stdin:{contents:prelude+batch,loader:'tsx'},bundle:true,minify:true,format:'iife',globalName:'__OpenMarketButtons',write:false,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;
const changed=base.replace(a,'o.createElement(__OpenMarketButtons.MarketStatusBatch,');assert.equal(changed.replace('o.createElement(__OpenMarketButtons.MarketStatusBatch,',a),base);
save(r+'/web-payload'+next,add+'\n'+changed);
for(const k in map.imports)if(map.imports[k]===old)map.imports[k]=next;map.imports[old]=next;html=html.replace(m[1],()=>JSON.stringify(map));save(r+'/web-payload/index.html',html);save(r+'/web-changes.json',JSON.stringify(['index.html',next.slice(1)]));
console.log('Exact API4/web2 prepared; original web body preserved except one component reference');

const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const r=path.resolve(process.argv[2]),old='admin-tiles-20261019-4.js',next='history-refresh-20261022.js';
let s=fs.readFileSync(r+'/web-base/assets/'+old,'utf8');
function replace(a,b){assert.equal(s.split(a).length,2,a);s=s.replace(a,b)}
replace('[U,z]=b();S(()=>{if(!r||!s)return;let e=!1;return v(!0),k(""),p([]),','[U,z]=b(),scopeRef=o.useRef();S(()=>{if(!r||!s)return;const scope=JSON.stringify([s,i.requestId,l]);if(scopeRef.current!==scope){p([]);z(void 0);scopeRef.current=scope}let e=!1;return v(!0),k(""),');
replace('),f&&t.createElement("p",{role:"status"}', '),f&&w.length===0&&t.createElement("p",{role:"status"}');
fs.mkdirSync(r+'/web/payload/assets',{recursive:true});fs.writeFileSync(r+'/web/payload/assets/'+next,s);
let html=fs.readFileSync(r+'/web-base/index.html','utf8');assert(!html.includes('"/assets/'+old+'":'));html=html.replace('{"imports":{','{"imports":{"/assets/'+old+'":"/assets/'+next+'",');fs.writeFileSync(r+'/web/payload/index.html',html);fs.writeFileSync(r+'/web-changes.json',JSON.stringify(['index.html','assets/'+next]));
console.log('Patched only history effect and loading indicator in current runtime');

// FIX: preserve the complete live FBS module and change only its pre-print preparation block.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),base='assets/fbs-wb-refresh-ozon-confirm-20261122.js',next='assets/ozon-pre-pick-fbs-20261125.js';
const input=fs.readFileSync(path.join(root,'web-base',base),'utf8');
const before=`if(all==="print"&&pending.length){
 if(!window.confirm("Подтвердить сборку в Ozon и распечатать стикеры?"+String.fromCharCode(10)+pending.map(order=>order.id).join(", ")))return;
 await en(s.accessToken,{clientId:f,orders:pending.map(order=>({connectionId:order.connectionId,id:order.id}))});
}`;
assert.equal(input.split(before).length,2,'Unexpected published pre-print handler');
const helper=`// FIX: prepare official stickers without claiming a physical warehouse pick.
async function __prepareOzonLabelsForPrint(token,payload){
 const response=await fetch('/api/v1/marketplace-connections/fbs/orders/prepare-labels',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const data=await response.json();if(!response.ok)throw Error(Array.isArray(data.message)?data.message.join(' '):data.message||'Не удалось подготовить стикеры Ozon.');return data;
}
`;
const after=`if(all==="print"&&pending.length){
 if(!window.confirm("Подготовить стикеры в Ozon для сборки?\\nСтатус в Ozon изменится на «Ожидает отгрузки». Фактический отбор в WMS выполняется после печати.\\n"+pending.map(order=>order.id).join(", ")))return;
 const prepared=await __prepareOzonLabelsForPrint(s.accessToken,{clientId:f,orders:pending.map(order=>({connectionId:order.connectionId,id:order.id}))});
 if(prepared.requiresPhysicalSubmission?.length)await en(s.accessToken,{clientId:f,orders:prepared.requiresPhysicalSubmission});
}`;
const output=helper+input.replace(before,after);
let html=fs.readFileSync(path.join(root,'web-base/index.html'),'utf8');
const match=html.match(/(<script type="importmap">)([\s\S]*?)(<\/script>)/);assert(match,'Missing import map');
const map=JSON.parse(match[2]);let aliases=0;
for(const name of Object.keys(map.imports))if(map.imports[name]==='/'+base){map.imports[name]='/'+next;aliases++;}
assert(aliases>0,'Published FBS module is not reachable');map.imports['/'+base]='/'+next;
html=html.replace(match[0],match[1]+JSON.stringify(map)+match[3]).replace('src="/'+base+'"','src="/'+next+'"');
const target=path.join(root,'web');fs.mkdirSync(path.join(target,'assets'),{recursive:true});
fs.writeFileSync(path.join(target,next),output);fs.writeFileSync(path.join(target,'index.html'),html);
fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(['index.html',next]));
console.log(JSON.stringify({changed:['index.html',next],updatedAliases:aliases,handlerReplacements:1}));

// FIX: replace only the Ozon import island; preserve the complete published module graph.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root=path.resolve(process.argv[2]),w=path.resolve(__dirname,'../../..'),src=w+'/apps/web/src/';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const ast=(s,n='x.js')=>ts.createSourceFile(n,s,99,true,n.endsWith('.tsx')?ts.ScriptKind.TSX:n.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
function body(file){const s=fs.readFileSync(src+file,'utf8'),a=ast(s,file);return a.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(a)).join('\n');}
function save(where,s){const f=root+'/'+where;fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s);}
const old='/assets/fbo-modal-rows-ozon-20261029.js',next='/assets/ozon-import-stock-20261030.js';
const base=fs.readFileSync(root+'/web-base'+old,'utf8'),tree=ast(base);
const owners=[];function visit(n){if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)==='__OzonImportLinks'))owners.push(n);ts.forEachChild(n,visit);}visit(tree);assert.equal(owners.length,1);
const api=`const React=e;const {useState,useEffect,useRef,useCallback}=React;const OzonEditCountdown=__Deadline.OzonEditCountdown;
 async function call(path,token,body){const response=await fetch('/api/v1'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...body instanceof FormData?{}:{'Content-Type':'application/json'}},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(Array.isArray(data.message)?data.message.join('; '):data.message??('HTTP '+response.status));return data;}
 function form(p){const f=new FormData();for(const[k,v]of Object.entries(p))if(v!=null&&v!=='')f.append(k,v);return f;}
 const ozonCustomerImportEnabled=t=>call('/ozon-fbo-import/capability',t),fetchOzonCustomerWarehouses=(t,c)=>call('/ozon-fbo-import/warehouses?clientId='+encodeURIComponent(c),t);
 const previewOzonCustomerFile=(t,p)=>call('/ozon-fbo-import/preview',t,form(p)),createOzonCustomerFile=(t,p)=>call('/ozon-fbo-import/commit',t,form(p));
 const fetchOzonLinkConnections=(t,c)=>call('/ozon-fbo-import/link-connections?clientId='+encodeURIComponent(c),t),previewOzonLinks=(t,p)=>call('/ozon-fbo-import/links/preview',t,p),createOzonLinks=(t,p)=>call('/ozon-fbo-import/links/commit',t,p);
 const previewClientRequestAvailability=(t,p)=>call('/client-requests/availability-preview',t,p);
 const ozonAdjustment=(t,id,a,b={})=>call('/tsd/requests/'+encodeURIComponent(id)+'/fbo/ozon-adjustment'+(a?'/'+a:''),t,a?b:undefined),ozonSync=ozonAdjustment;
 const ozonAssemblySupply=(t,id,a,b={})=>call('/ozon-fbo-import/requests/'+encodeURIComponent(id)+'/supply'+(a?'/'+a:''),t,a?b:undefined);
 async function downloadOzonCargoMapping(t,id){const r=await fetch('/api/v1/ozon-fbo-import/requests/'+encodeURIComponent(id)+'/supply/cargo-mapping.xlsx',{headers:{Authorization:'Bearer '+t}});if(!r.ok)throw Error('Не удалось скачать соответствия');return r.blob();}
 `;
const files=['components/client-requests/OzonImportStockReview.tsx','components/client-requests/OzonStockAdjustment.tsx','components/ozon-fbo/OzonAssemblySupply.tsx','components/client-requests/OzonImportCorrection.tsx','components/client-requests/OzonLinkImport.tsx','components/client-requests/OzonCustomerImport.tsx'];
const result=esbuild.buildSync({stdin:{contents:api+files.map(body).join('\n'),loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__OzonImportLinks',minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;
const n=owners[0],before=base.slice(0,n.getStart(tree)),after=base.slice(n.end),code=before+result+after;
assert.equal(ast(code).parseDiagnostics.length,0);assert.equal(code.slice(0,before.length),before);assert.equal(code.slice(-after.length),after);
save('web/payload'+next,code);
let html=fs.readFileSync(root+'/web-base/index.html','utf8'),m=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(m);const map=JSON.parse(m[1]);assert.equal(map.imports['/assets/admin-tiles-20261019-14.js'],old);
for(const k of Object.keys(map.imports))if(map.imports[k]===old)map.imports[k]=next;map.imports[old]=next;html=html.replace(m[1],JSON.stringify(map));save('web/payload/index.html',html);
// API source changes: scoped CLIENT exception and preserved staff stock-write gate only.
const proof={web:{baseSha:sha(base),sha:sha(code),sourceFiles:files,preservedPrefix:sha(before),preservedSuffix:sha(after)},api:{}};
for(const name of ['modules/client-requests/ozon-assembly-supply.service.js','modules/tsd/ozon-stock-adjustment.service.js','modules/tsd/ozon-stock-adjustment.controller.js']){
 let s=fs.readFileSync(root+'/api-base/'+name,'utf8'),original=s;
 const once=(a,b)=>{assert.equal(s.split(a).length,2,a);s=s.replace(a,b);};
 if(name.endsWith('controller.js'))once("(0, require_permissions_decorator_1.RequirePermissions)('client-requests:write', 'stock:write')","(0, require_permissions_decorator_1.RequirePermissions)('client-requests:write')");
 else {
 const condition=name.includes('ozon-assembly')?'!user.activeWarehouseId || s.request.warehouseId !== user.activeWarehouseId':'!user.activeWarehouseId || user.activeWarehouseId !== s.request.warehouseId';
 once('if ('+condition+')',"if (!(user.roleCodes ?? []).includes('CLIENT') && ("+condition+'))');
 if(name.includes('stock-adjustment'))once("throw new common_1.NotFoundException('ФБО Ozon выключено.');","throw new common_1.NotFoundException('ФБО Ozon выключено.');\n        if (!(user.roleCodes ?? []).includes('CLIENT') && !(user.permissionCodes ?? []).some(p => ['system:admin', 'stock:write'].includes(p))) throw new common_1.ForbiddenException('Нет права изменения складских заявок.');");
 }
 assert.equal(ast(s).parseDiagnostics.length,0);save('api/payload/'+name,s);proof.api[name]={before:sha(original),after:sha(s)};
}
save('patch-proof.json',JSON.stringify(proof,null,2));console.log('Exact three API and two web file overlay prepared');

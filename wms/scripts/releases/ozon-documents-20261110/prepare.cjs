// FIX: exact own-runtime delta, preserving unrelated releases.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]);const read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const compile=(s,module=ts.ModuleKind.CommonJS)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module}}).outputText;
const dir='modules/marketplace-connections/';let base=read(root+'/api-base/'+dir+'marketplace-connections.service.js'),s=base;
const a='pairs: selected => this.getFbsOrderStickersPdf({ clientId, orders: selected }, user, orders),\n        });';
assert.equal(s.split(a).length,2);s=s.replace(a,a.replace('});','}, process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED === "true");'));
write(root+'/api-payload/'+dir+'marketplace-connections.service.js',s);
write(root+'/api-payload/'+dir+'wb-all-labels.js',compile(read('apps/api/src/'+dir+'wb-all-labels.ts')));
write(root+'/api-changes.json',JSON.stringify([dir+'marketplace-connections.service.js',dir+'wb-all-labels.js']));
fs.cpSync(root+'/api-base',root+'/api-candidate',{recursive:true});fs.cpSync(root+'/api-payload',root+'/api-candidate',{recursive:true});
const old='assets/wb-shipping-search-fbs-20261109.js',next='assets/ozon-documents-fbs-20261110.js';base=read(root+'/web-base/'+old);s=base;const patches=[];
function once(a,b){assert.equal(s.split(a).length,2,a);s=s.replace(a,b);patches.push([a,b]);}
once('openWbRibbonPrint(s.accessToken,f,result)','openWbRibbonPrint(s.accessToken,f,result,o.every(x=>x.marketplace==="OZON")?"Ozon":"WB")');
once('./wb-ribbon-print-dialog-20261108.js','./ozon-documents-print-dialog-20261110.js');
once('className:"fbs-order-documents",children:[s.marketplace==="WILDBERRIES"?', 'className:"fbs-order-documents",children:[["WILDBERRIES","OZON"].includes(s.marketplace)?');
// Selected Ozon orders use the actual selected set Ae, not unselected orders.
assert(s.includes('Ae=he.filter(m=>n.has(ke(m)))'));
const buttons=['true','"print"'].map((mode,i)=>`e.jsx("button",{type:"button",className:"button button-secondary",disabled:l!==null||!Ae.some(o=>o.marketplace==="OZON"),onClick:()=>void F(Ae.filter(o=>o.marketplace==="OZON"),${mode}),children:"${i?'Печать всех ШК':'Скачать все ШК'}"})`).join(',');
once('className:"fbs-order-actions",children:[','className:"fbs-order-actions",children:[he.some(o=>o.marketplace==="OZON")?e.jsxs("div",{className:"fbs-order-actions__buttons",children:['+buttons+']}):null,');
let inverse=s;for(const[a,b]of [...patches].reverse())inverse=inverse.replace(b,a);assert.equal(inverse,base);
assert.equal(ts.createSourceFile('fbs.js',s,99,true).parseDiagnostics.length,0);write(root+'/web-payload/'+next,s);
const dialog='assets/ozon-documents-print-dialog-20261110.js';write(root+'/web-payload/'+dialog,compile(read('apps/web/src/lib/wbRibbonPrint.ts'),ts.ModuleKind.ES2022));
let html=read(root+'/web-base/index.html'),m=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(m[1]),count=0;
for(const key in map.imports)if(map.imports[key]==='/'+old){map.imports[key]='/'+next;count++}assert(count);map.imports['/'+old]='/'+next;html=html.replace(m[1],()=>JSON.stringify(map));write(root+'/web-payload/index.html',html);
write(root+'/web-changes.json',JSON.stringify(['index.html',next,dialog]));write(root+'/overlay-proof.json',JSON.stringify({apiFiles:2,webFiles:3,webInverse:true}));
console.log('API2/web3 prepared');

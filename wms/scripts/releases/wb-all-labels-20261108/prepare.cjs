// FIX: additive overlay against the verified runtime, not a full source rebuild.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const patches=[];
function once(s,old,next){assert.equal(s.split(old).length,2,old.slice(0,90));patches.push([old,next]);return s.replace(old,next)}
function preserve(s,base){for(const[old,next]of [...patches].reverse())s=s.replace(next,old);assert.equal(s,base);patches.length=0}
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
const dir='modules/marketplace-connections/';
let file=dir+'marketplace-connections.service.js',base=read(root+'/api-base/'+file),s=base;
const method=read('apps/api/src/'+dir+'marketplace-connections.service.ts').split('  async getFbsAllLabels(')[1].split('  async getFbsOrderStickersPdf(')[0];
let compiled=compile('class Ribbon { async getFbsAllLabels('+method+'}');
compiled=compiled.slice(compiled.indexOf('    async getFbsAllLabels'),compiled.lastIndexOf('}')).replace('wbAllLabels(', 'require("./wb-all-labels").wbAllLabels(');
s=once(s,'    async getFbsOrderStickersPdf(',compiled+'    async getFbsOrderStickersPdf(');preserve(s,base);write(root+'/api-payload/'+file,s);
file=dir+'marketplace-connections.controller.js';base=read(root+'/api-base/'+file);s=base;
s=once(s,'    async getFbsOrderStickersPdf(', '    async getFbsAllLabels(dto, user) { return this.connections.getFbsAllLabels(dto, user); }\n    async getFbsOrderStickersPdf(');
const end=s.indexOf('], MarketplaceConnectionsController.prototype, "getFbsOrderStickersPdf", null);');assert(end>0);
const begin=s.lastIndexOf('__decorate([',end),dec=s.slice(begin,end)+'], MarketplaceConnectionsController.prototype, "getFbsOrderStickersPdf", null);';
let newDec=dec.replace('fbs/orders/stickers.pdf','fbs/orders/all-labels').replace('"getFbsOrderStickersPdf"','"getFbsAllLabels"')
 .replace(/    __param\(2,[^\n]+\n/,'').replace(/__metadata\("design:paramtypes", \[([^\]]+)\]\)/,(_,types)=>'__metadata("design:paramtypes", ['+types.split(',').slice(0,2).join(',')+'])');
s=once(s,dec,newDec+'\n'+dec);preserve(s,base);write(root+'/api-payload/'+file,s);
write(root+'/api-payload/'+dir+'wb-all-labels.js',compile(read('apps/api/src/'+dir+'wb-all-labels.ts')));
write(root+'/api-changes.json',JSON.stringify(['marketplace-connections.service.js','marketplace-connections.controller.js','wb-all-labels.js'].map(f=>dir+f)));
file='modules/administration/administration-internal-api.service.js';base=read(root+'/api-base/'+file);
const registry=base.indexOf("id: 'marketplace-connections'");assert(registry>0);
const count=/routeCount: (\d+)/.exec(base.slice(registry));assert(count);
const offset=registry+count.index;
write(root+'/api-payload/'+file,base.slice(0,offset)+count[0].replace(count[1],String(Number(count[1])+1))+base.slice(offset+count[0].length));
const apiFiles=JSON.parse(read(root+'/api-changes.json'));apiFiles.push(file);write(root+'/api-changes.json',JSON.stringify(apiFiles));
fs.cpSync(root+'/api-base',root+'/api-candidate',{recursive:true});fs.cpSync(root+'/api-payload',root+'/api-candidate',{recursive:true});
const oldMain='/assets/stock-export-20261106.js',newMain='/assets/wb-all-labels-api-20261108.js';
base=read(root+'/web-base'+oldMain);
assert(base.includes('function z(')&&base.includes('function ss('));
write(root+'/web-payload'+newMain,base+'\nexport async function __downloadWbAllLabels(token, payload) { return z("/marketplace-connections/fbs/orders/all-labels", {method:"POST",accessToken:token,body:ss(payload)}); }\n');
const oldWeb='/assets/fabric-reservation-fbs-20261108.js',newWeb='/assets/wb-all-labels-fbs-20261108.js';base=read(root+'/web-base'+oldWeb);s=base;
s=once(s,'async function ga(o){','async function ga(o,all=false){');
const anchor='try{const y=await En(s.accessToken,{clientId:f,orders:o.map(E=>({connectionId:E.connectionId,id:E.id}))});';
s=once(s,anchor,`try{if(all===true){const result=await __downloadWbAllLabels(s.accessToken,{clientId:f,orders:o.map(E=>({connectionId:E.connectionId,id:E.id}))});const bytes=Uint8Array.from(atob(result.fileBase64),c=>c.charCodeAt(0));Is(new Blob([bytes],{type:"application/pdf"}),result.fileName);ie("Скачана лента: "+result.pageCount+" стр.");if(result.warnings.length)le("Скачан неполный комплект. "+result.warnings.join(" "));return;}const y=await En(s.accessToken,{clientId:f,orders:o.map(E=>({connectionId:E.connectionId,id:E.id}))});`);
s=once(s,'onDownloadSticker:()=>void F([X])','onDownloadSticker:(all=false)=>void F([X],all)');
s=once(s,'disabled:!N||l,onClick:W,','disabled:!N||l,onClick:()=>W(),');
const row='className:"fbs-order-documents",children:[';
s=once(s,row,row+'s.marketplace==="WILDBERRIES"?e.jsxs("button",{type:"button",className:"fbs-order-document-button",disabled:l,onClick:()=>W(true),children:[e.jsx(Cs,{size:14,"aria-hidden":"true"}),"Скачать все ШК"]}):null,');
const group='e.jsxs("button",{type:"button",disabled:os.length===0||l!==null,onClick:()=>void F(os),';
s=once(s,group,'e.jsxs("button",{type:"button",disabled:l!==null,onClick:()=>void F(m.orders,true),children:[e.jsx(Cs,{size:14,"aria-hidden":"true"}),"Все ШК"]}),'+group);
// Use the complete selected WB set, including orders whose labels are not ready.
const selected=s.match(/const ([\w$]+)=([^;]+?)\.filter\([^;]+?\),ls=/); // selected set is located by the AST below.
const ast=ts.createSourceFile('fbs.js',s,99,true,ts.ScriptKind.JS);let selectedName;
function visit(n){if(ts.isVariableDeclaration(n)&&n.initializer?.getText(ast).includes('.filter(')&&n.initializer.getText(ast).includes('n.has(ke('))selectedName=n.name.getText(ast);ts.forEachChild(n,visit)}visit(ast);
assert(selectedName,'Selected order list');
const toolbar='be?e.jsxs(e.Fragment,{children:[e.jsxs("button",{type:"button",className:"button button-secondary",disabled:ps.length===0';
s=once(s,toolbar,'be?e.jsxs(e.Fragment,{children:[e.jsxs("button",{type:"button",className:"button button-secondary",disabled:l!==null,onClick:()=>void F('+selectedName+'.filter(o=>o.marketplace==="WILDBERRIES"),true),children:[e.jsx(Cs,{size:16,"aria-hidden":"true"}),"Скачать все ШК"]}),e.jsxs("button",{type:"button",className:"button button-secondary",disabled:ps.length===0');
preserve(s,base);s='import { __downloadWbAllLabels } from "./admin-tiles-20261019-0.js";\n'+s;
assert.equal(ts.createSourceFile('fbs.js',s,99,true,ts.ScriptKind.JS).parseDiagnostics.length,0);write(root+'/web-payload'+newWeb,s);
let html=read(root+'/web-base/index.html'),match=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(match[1]);
for(const[old,next]of[[oldWeb,newWeb],[oldMain,newMain]]){let count=0;for(const key of Object.keys(map.imports))if(map.imports[key]===old){map.imports[key]=next;count++;}assert(count);map.imports[old]=next;}
html=html.replace(match[1],()=>JSON.stringify(map));write(root+'/web-payload/index.html',html);
write(root+'/web-changes.json',JSON.stringify(['index.html',newWeb.slice(1),newMain.slice(1)]));
write(root+'/overlay-proof.json',JSON.stringify({apiFiles:4,webFiles:3,existingBytesPreserved:true}));console.log('API4/web3 prepared');

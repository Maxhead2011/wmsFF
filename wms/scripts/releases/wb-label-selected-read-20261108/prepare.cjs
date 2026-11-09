// FIX: patch only printing methods in the published runtime, retaining all unrelated overlays.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]);
const file='modules/marketplace-connections/marketplace-connections.service.js';
const read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
let s=read(root+'/api-base/'+file),base=s;const pairs=[];
function replace(a,b){assert.equal(s.split(a).length,2,a.slice(0,100));s=s.replace(a,b);pairs.push([a,b]);}
function method(source,name){const ast=ts.createSourceFile('a.js',source,99,true);let found;function walk(n){if(ts.isMethodDeclaration(n)&&n.name.getText(ast)===name){assert(!found);found=n.getText(ast)}ts.forEachChild(n,walk)}walk(ast);assert(found,name);return found;}
const source=compile(read('apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts'));
replace('const { fabricPairedLabels }', 'const wb_label_orders_1 = require("./wb-label-orders");\nconst { fabricPairedLabels }');
replace('    async getFbsAllLabels(dto, user) {','    '+method(source,'resolveFbsLabelOrders')+'\n    async getFbsAllLabels(dto, user) {');
for(const name of ['getFbsAllLabels','getFbsOrderStickersPdf','getFbsCargoPlaceStickersPdf','getFbsSupplyStickersPdf']){
 const old=method(s,name);let next=old;
 if(name==='getFbsAllLabels')next=next.replace('this.resolveSelectedFbsOrders(clientId, dto.orders)','this.resolveFbsLabelOrders(clientId, dto.orders)').replaceAll('}, user)','}, user, orders)');
 else {
  next=next.replace('(dto, user)', '(dto, user, snapshot)');
  if(name==='getFbsOrderStickersPdf'){
   next=next.replace('const paired =', 'let resolved;\n        const resolve = () => resolved ??= this.resolveFbsLabelOrders(clientId, dto.orders, snapshot);\n        const paired =');
   next=next.replace('selection => this.resolveSelectedFbsOrders(clientId, selection)','async selection => this.resolveFbsLabelOrders(clientId, selection, (await resolve()).orders)');
   next=next.replace('await this.resolveSelectedFbsOrders(clientId, dto.orders)','await resolve()');
  }else next=next.replace('this.resolveSelectedFbsOrders(clientId, dto.orders)','this.resolveFbsLabelOrders(clientId, dto.orders, snapshot)');
 }
 assert.notEqual(old,next,name);assert(!next.includes('this.resolveSelectedFbsOrders'),name);replace(old,next);
}
let inverse=s;for(const[a,b]of [...pairs].reverse())inverse=inverse.replace(b,a);assert.equal(inverse,base);
assert.equal(ts.createSourceFile('a.js',s,99,true).parseDiagnostics.length,0);
write(root+'/api-payload/'+file,s);
const helper='modules/marketplace-connections/wb-label-orders.js';write(root+'/api-payload/'+helper,compile(read('apps/api/src/modules/marketplace-connections/wb-label-orders.ts')));
fs.cpSync(root+'/api-base',root+'/api-candidate',{recursive:true});fs.cpSync(root+'/api-payload',root+'/api-candidate',{recursive:true});
write(root+'/api-changes.json',JSON.stringify([file,helper]));write(root+'/overlay-proof.json',JSON.stringify({apiFiles:2,webFiles:0,existingBytesPreserved:true}));
console.log('Exact API2 overlay; inverse proof passed');

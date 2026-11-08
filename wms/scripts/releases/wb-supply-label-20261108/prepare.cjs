// FIX: exact API overlay; retain every published byte outside the supply-label branch.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),file='modules/marketplace-connections/marketplace-connections.service.js';
const read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
let s=read(root+'/api-base/'+file),base=s;const pairs=[];
function replace(a,b){assert.equal(s.split(a).length,2,a.slice(0,100));s=s.replace(a,b);pairs.push([a,b]);}
function method(source,name){const ast=ts.createSourceFile('a.js',source,99,true);let found;function walk(n){if(ts.isMethodDeclaration(n)&&n.name.getText(ast)===name){assert(!found);found=n.getText(ast)}ts.forEachChild(n,walk)}walk(ast);assert(found,name);return found;}
const source=compile(read('apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts'));
replace('const wb_label_orders_1 = require("./wb-label-orders");','const wb_label_orders_1 = require("./wb-label-orders");\nconst wb_supply_label_1 = require("./wb-supply-label");');
const old=method(s,'getFbsSupplyStickersPdf'),next=method(source,'getFbsSupplyStickersPdf');
// Only the newly inserted early return may differ from the exact published method.
const start=next.indexOf('        // FIX: our WMS'),end=next.indexOf('        const [{ orders }, deliveryPlan]');
assert(start>0&&end>start);assert.equal(next.slice(0,start)+next.slice(end),old);
replace(old,next);
let inverse=s;for(const[a,b]of [...pairs].reverse())inverse=inverse.replace(b,a);assert.equal(inverse,base);
assert.equal(ts.createSourceFile('a.js',s,99,true).parseDiagnostics.length,0);
write(root+'/api-payload/'+file,s);
const helper='modules/marketplace-connections/wb-supply-label.js';write(root+'/api-payload/'+helper,compile(read('apps/api/src/modules/marketplace-connections/wb-supply-label.ts')));
fs.cpSync(root+'/api-base',root+'/api-candidate',{recursive:true});fs.cpSync(root+'/api-payload',root+'/api-candidate',{recursive:true});
write(root+'/api-changes.json',JSON.stringify([file,helper]));write(root+'/overlay-proof.json',JSON.stringify({apiFiles:2,webFiles:0,existingBytesPreserved:true}));
console.log('Exact API2 overlay; inverse proof passed');

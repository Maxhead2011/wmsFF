// FIX: patch only the verified creation callsite; preserve the rest of the live Lamoda module.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('../../../node_modules/typescript');
const candidate=process.argv[2];assert(candidate);
const service=path.join(candidate,'modules/lamoda/lamoda.service.js');
const before=fs.readFileSync(service,'utf8');
const marker='const warehouse = (0, lamoda_fbo_policy_1.useLamodaWarehouseBarcodes)(resolved, skus);';
assert.equal(before.split(marker).length,2,'Expected one creation callsite');
fs.writeFileSync(service,before.replace(marker,marker+"\n                await require('./lamoda-stock-guard').assertLamodaStockAvailable(tx, c.clientId, plan.warehouseId, warehouse.items);"));
const source=path.resolve(__dirname,'../../../apps/api/src/modules/lamoda/lamoda-stock-guard.ts');
fs.writeFileSync(path.join(candidate,'modules/lamoda/lamoda-stock-guard.js'),ts.transpileModule(fs.readFileSync(source,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText);
console.log('Two-file Lamoda stock guard candidate prepared');

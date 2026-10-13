// FIX: patch only barcode identities in the pinned runtime, preserving optimized packing and Ozon adjustment.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const w=path.resolve(__dirname,'../../..'),ts=require(path.join(w,'node_modules/typescript')),r=process.argv[2];
const n='modules/tsd/fbo-two-stage.service.js',p=path.join(r,'api',n);let s=fs.readFileSync(p,'utf8');
const replace=(a,b,count=1)=>{assert.equal(s.split(a).length-1,count,a);s=s.split(a).join(b);};
replace('"use strict";','"use strict";\nconst fboBarcodeAliases=require("./fbo-barcode-aliases");');
replace('skuId: i.skuId, barcode: i.barcode,','skuId: i.skuId, barcode: i.barcode, barcodes: fboBarcodeAliases.fboBarcodeAliases(i,r.items),');
replace('(l.barcode === dto.barcode || l.sku.barcodes.some(b => b.value === dto.barcode))','fboBarcodeAliases.fboBarcodeMatches(l.skuId,dto.barcode,r.items)');
replace('u.barcode === dto.barcode','fboBarcodeAliases.fboBarcodeMatches(u.skuId,dto.barcode,r.items)',2);
replace('this.packingProgress(tx, id, dto)','this.packingProgress(tx, id, dto, r.items)');
replace('async packingProgress(tx, requestId, dto) {','async packingProgress(tx, requestId, dto, items = []) {');
replace("{ barcode: dto.barcode ?? '' }","{ skuId: { in: [...new Set(items.filter(i=>fboBarcodeAliases.fboBarcodeMatches(i.skuId,dto.barcode,items)).map(i=>i.skuId))] } }");
fs.writeFileSync(p,s);
const helper='modules/tsd/fbo-barcode-aliases.js';fs.writeFileSync(path.join(r,'api',helper),ts.transpileModule(fs.readFileSync(path.join(w,'apps/api/src/modules/tsd/fbo-barcode-aliases.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
fs.writeFileSync(path.join(r,'api-changes.json'),JSON.stringify([n,helper]));
console.log('Two API modules patched; optimized reads remain scoped to request and SKU.');

const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const r=process.argv[2];
function once(s,a,b){assert.equal(s.split(a).length,2);return s.replace(a,()=>b)}
let api=fs.readFileSync(path.join(r,'api-base/modules/turnover/turnover.service.js'),'utf8');
api=once(api,'const primaryBarcode = balance.sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? barcodes[0] ?? null;',"const primaryBarcode = require('./stock-export-barcode').stockExportBarcode(clientId, balance.sku.barcodes);");
fs.mkdirSync(path.join(r,'payload/modules/turnover'),{recursive:true});
fs.writeFileSync(path.join(r,'payload/modules/turnover/turnover.service.js'),api);
fs.writeFileSync(path.join(r,'payload/modules/turnover/stock-export-barcode.js'),ts.transpileModule(fs.readFileSync('apps/api/src/modules/turnover/stock-export-barcode.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
let h=fs.readFileSync(path.join(r,'web-base/index.html'),'utf8');const m=h.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(m[1]);
const entry=h.match(/<script type="module" crossorigin src="([^"]+)"/)[1],next='/assets/stock-export-20261106.js';
let s=fs.readFileSync(path.join(r,'web-base',entry),'utf8');
s=once(s,'Игнорировать текущие заявки и скачать полный остаток','Скачать полный остаток вместе с резервами');
s=once(s,'Если галочка снята, WMS вычтет','С галочкой резервы не вычитаются. Ограничения видимости коробов сохраняются. Если галочка снята, WMS вычтет');
assert.equal(ts.createSourceFile('patched.js',s,99,true,ts.ScriptKind.JS).parseDiagnostics.length,0);
fs.mkdirSync(path.join(r,'web-payload/assets'),{recursive:true});fs.writeFileSync(path.join(r,'web-payload',next),s);
for(const k of Object.keys(map.imports))if(map.imports[k]===entry)map.imports[k]=next;map.imports[entry]=next;
h=h.replace(m[1],()=>JSON.stringify(map)).replace('src="'+entry+'"','src="'+next+'"');
assert.equal((h.match(new RegExp('src="'+next+'"','g'))||[]).length,1);
fs.writeFileSync(path.join(r,'web-payload/index.html'),h);

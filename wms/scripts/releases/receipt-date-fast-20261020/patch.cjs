const fs=require('fs'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const root=process.argv[2];
const common='common/receipt-batches.js',service='modules/warehouse/warehouse.service.js';
let s=fs.readFileSync(root+'/api/'+common,'utf8'),a=ts.createSourceFile('x',s,99,true);
const fn=a.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='receiptDateFromBoxCode');assert(fn);
let f=fn.getText(a);assert.equal((f.match(/moscowDateKey\(fallback\)/g)||[]).length,3);
f=f.replace('receiptPrefix = DEFAULT_RECEIPT_BOX_PREFIX)', 'receiptPrefix = DEFAULT_RECEIPT_BOX_PREFIX, formatDate = moscowDateKey)').replaceAll('moscowDateKey(fallback)','formatDate(fallback)');
assert(f.includes('formatDate = moscowDateKey'));s=s.slice(0,fn.getStart(a))+f+s.slice(fn.end);fs.writeFileSync(root+'/api/'+common,s);
s=fs.readFileSync(root+'/api/'+service,'utf8');
const before="const groups = new Map();\n        for (const movement of movements) {\n            const date = (0, receipt_batches_1.receiptDateFromBoxCode)(movement.box?.code ?? '', movement.createdAt, receiptPrefix);";
assert.equal(s.split(before).length,2);
// FIX: scoped list-only reuse; all other callers keep the original default.
s=s.replace(before,"const groups = new Map();\n        const receiptDateFormatter = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'});\n        for (const movement of movements) {\n            const date = (0, receipt_batches_1.receiptDateFromBoxCode)(movement.box?.code ?? '', movement.createdAt, receiptPrefix, value => receiptDateFormatter.format(value));");
assert.equal(ts.createSourceFile('x',s,99,true).parseDiagnostics.length,0);fs.writeFileSync(root+'/api/'+service,s);
fs.writeFileSync(root+'/api-changes.json',JSON.stringify([common,service]));

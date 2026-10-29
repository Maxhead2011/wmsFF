// FIX: transplant only reviewed transport methods into the pinned current runtime.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),w=path.resolve(__dirname,'../../..');
const options={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true};
function ast(s){return ts.createSourceFile('module.js',s,99,true)}
function method(s,name){const a=ast(s),hits=[];function walk(n){if(ts.isMethodDeclaration(n)&&n.name.getText(a)===name)hits.push(n);ts.forEachChild(n,walk)}walk(a);assert.equal(hits.length,1,name);return{a,n:hits[0]}}
function replace(s,m,next){return s.slice(0,m.n.getStart(m.a))+next+s.slice(m.n.end)}
function input(n){const p=root+'/api/payload/'+n;return fs.readFileSync(fs.existsSync(p)?p:root+'/base-api/'+n,'utf8')}
function save(n,s){assert.equal(ast(s).parseDiagnostics.length,0,n);const p=root+'/api/payload/'+n;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)}
function compiled(n){return ts.transpileModule(fs.readFileSync(w+'/apps/api/src/'+n.replace(/\.js$/,'.ts'),'utf8'),{compilerOptions:options}).outputText}
const helper='modules/tsd/kiz-receipt-conflict.js';save(helper,compiled(helper));
const log='modules/tsd/tsd-operation-log.service.js';let s=input(log),c=compiled(log);
for(const n of ['findExisting','recordResult','existingResult','result']){const next=method(c,n);s=replace(s,method(s,n),next.n.getText(next.a))}
s='const kiz_receipt_conflict_1 = require("./kiz-receipt-conflict");\n'+s;save(log,s);
const sync='modules/tsd/tsd-sync.service.js';s=input(sync);const m=method(s,'applyReceiptScan'),old=m.n.getText(m.a);
const needle='client_1.TsdReviewReason.RECEIPT_FAILED);';assert.equal(old.split(needle).length,2);
s=replace(s,m,old.replace(needle,'client_1.TsdReviewReason.RECEIPT_FAILED, undefined, require("./kiz-receipt-conflict").receiptConflictFromError(caught), { clientId: payload.clientId, warehouseId: user.activeWarehouseId });'));
const apply=method(s,'applyOperation'),applyText=apply.n.getText(apply.a),replay='this.operationLog.existingResult(operation, existing)';assert.equal(applyText.split(replay).length,2);
const deviceGuard='if (user.deviceCode && operation.deviceId !== user.deviceCode) {';assert.equal(applyText.split(deviceGuard).length,2);
s=replace(s,apply,applyText.replace(replay,'this.operationLog.existingResult(operation, existing, user)').replace(deviceGuard,deviceGuard+'\nif (process.env.WMS_KIZ_CLIENT_GUARD_ENABLED === "true") return this.operationLog.result(operation, "REJECTED", "Операция пришла не от устройства из access token.", client_1.TsdReviewReason.DEVICE_MISMATCH);'));save(sync,s);
const controller='modules/tsd/tsd-device.controller.js';s=input(controller);c=compiled(controller);
const next=method(c,'queueReceiptKizReview'),before=method(s,'openReceiptBox');
s=s.slice(0,before.n.getStart(before.a))+next.n.getText(next.a)+'\n'+s.slice(before.n.getStart(before.a));
const ca=ast(c),decorators=ca.statements.filter(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(ca)==='__decorate'&&n.expression.arguments[2]?.getText(ca)==='"queueReceiptKizReview"');assert.equal(decorators.length,1);
// Record/AuthUser are erased interfaces: avoid copying transpiler-only temporary variables.
let d=decorators[0].getText(ca).replace(/__metadata\("design:paramtypes", \[[^\n]*\]\)/,'__metadata("design:paramtypes", [Object, Object])');
for(const alias of [...new Set(d.match(/\b\w+_\d+\./g)??[])])assert(s.includes('const '+alias.slice(0,-1)+' = require('),'Missing decorator import '+alias);
s+='\n'+d+'\n';save(controller,s);
const inventory='modules/administration/administration-internal-api.service.js';s=input(inventory);
const pattern=/(id: 'tsd',[\s\S]*?routeCount: )(\d+)/g;let matches=0;
s=s.replace(pattern,(_all,prefix,count)=>{matches++;return prefix+(Number(count)+1)});assert.equal(matches,1);save(inventory,s);
console.log('Receipt transport patched: durable duplicate metadata, explicit review route, existing other routes preserved.');

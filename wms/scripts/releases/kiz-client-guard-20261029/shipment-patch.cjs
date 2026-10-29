// FIX: minimal shipment gates over the verified runtime; preserve closed-FBO targets and all prior fixes.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const ts=require('../../../node_modules/typescript'),root=path.resolve(process.argv[2]);
function read(n){const p=root+'/api/payload/'+n;return fs.readFileSync(fs.existsSync(p)?p:root+'/base-api/'+n,'utf8')}
function save(n,s){assert.equal(ts.createSourceFile(n,s,99,true).parseDiagnostics.length,0);const p=root+'/api/payload/'+n;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)}
function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b)}
const stock='modules/stock/stock-operations.service.js';let s=read(stock);
s='const kizClientShipment=require("../../common/kiz-client-review");\n'+s;
for(const name of ['shipClientRequest','shipClientRequestFromCurrentStock']){
 const a=s.indexOf('    async '+name+'('),b=s.indexOf('\n    async ',a+10);assert(a>0&&b>a);
 let f=s.slice(a,b);
 f=once(f,'const result = await this.prisma.$transaction(async (tx) => {','const result = await kizClientShipment.withClientKizReview(this.prisma,user,()=>this.prisma.$transaction(async (tx) => {');
 const before=name==='shipClientRequest'?'            await this.ensurePackedStockIsInShipping(':'            // FIX: packaging still describes the full request; stock allocation contains only unshipped units.';
 f=once(f,before,'            await kizClientShipment.assertClientRequestKizShipment(tx,request,user);\n'+before);
 const capture='await (0, shipped_kiz_history_1.captureShippedKizHistory)(tx, request.id, doneAt);',idx=f.lastIndexOf(capture);assert(idx>0);
 f=f.slice(0,idx+capture.length)+'\n            await kizClientShipment.finishClientRequestKizShipment(tx,request);'+f.slice(idx+capture.length);
 if(name==='shipClientRequest')f=once(f,'}, fboShipment ? { maxWait: 10_000, timeout: 180_000 } : undefined);','}, fboShipment ? { maxWait: 10_000, timeout: 180_000 } : undefined));');
 else f=once(f,'        });\n        const logistics =','        }));\n        const logistics =');
 s=s.slice(0,a)+f+s.slice(b);
}
save(stock,s);
const lifecycle='common/stock/wb-order-stock-lifecycle.js';s=read(lifecycle);
s='const kizClientShipment=require("../kiz-client-review");\n'+s;
s=once(s,'    if (!alreadyShipped) {','    const kizUse=task.kiz?{scope:"FBS",clientId:task.clientId,warehouseId,requestId:request.id,taskId:task.id,kiz:task.kiz,skuId:task.skuId,boxId:task.boxId}:null;\n    if(!alreadyShipped&&kizUse)await kizClientShipment.assertClientKizUse(db,kizUse,{id:task.workerUserId??null});\n    if (!alreadyShipped) {');
s=once(s,'    return fact;','    if(!alreadyShipped&&kizUse)await kizClientShipment.finishClientKizUse(db,kizUse);\n    return fact;');save(lifecycle,s);
const background='common/reconciliation/wb-background.js';s=read(background);
s='const kizClientShipment=require("../kiz-client-review");\n'+s;
s=once(s,'await db.$transaction(async (tx) => {','await kizClientShipment.withClientKizReview(db,{id:full.workerUserId??null},()=>db.$transaction(async (tx) => {');
s=once(s,'}, { timeout: 30_000 });','}, { timeout: 30_000 }));');save(background,s);
console.log('Shipment gates patched; previous FBO target, accounting and reconciliation preserved.');

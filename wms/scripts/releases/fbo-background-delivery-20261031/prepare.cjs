// FIX: exact overlays over the verified live PR807 image; preserve runtime-only stock logic.
const fs=require('fs'),path=require('path'),ts=require('../../../node_modules/typescript'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),repo=path.resolve(__dirname,'../../..'),out=path.join(root,'payload');
function save(name,s){const p=path.join(out,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
function replace(s,a,b){assert.equal(s.split(a).length,2,'exact anchor: '+a);return s.replace(a,b);}
for(const name of ['fbo-delivery-policy','fbo-delivery-sync.service']){
 const s=fs.readFileSync(path.join(repo,'apps/api/src/modules/client-requests',name+'.ts'),'utf8');
 save('modules/client-requests/'+name+'.js',ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText);
}
let s=fs.readFileSync(path.join(root,'api-live/modules/stock/stock-operations.service.js'),'utf8').replace(/\r\n/g,'\n');
s=replace(s,'async shipClientRequest(dto, user) {','async shipClientRequest(dto, user, verifyDelivery) {');
s=replace(s,'if (fboShipment)\n                await tx.$queryRaw','if (fboShipment || verifyDelivery)\n                await tx.$queryRaw');
s=replace(s,"const request = await this.loadOutboundRequest(tx, dto.requestId, user, 'Отгрузка');","const request = await this.loadOutboundRequest(tx, dto.requestId, user, 'Отгрузка');\n            if (verifyDelivery) await verifyDelivery(tx); // FIX: same transaction/request lock");
save('modules/stock/stock-operations.service.js',s);
s=fs.readFileSync(path.join(root,'api-live/modules/client-requests/client-requests.module.js'),'utf8').replace(/\r\n/g,'\n');
s=replace(s,'providers: [wb_tracking_service.WbFboSupplyService,','providers: [require("./fbo-delivery-sync.service").FboDeliverySyncService,wb_tracking_service.WbFboSupplyService,');
save('modules/client-requests/client-requests.module.js',s);
console.log('Prepared exact API4; web/APK/schema unchanged');

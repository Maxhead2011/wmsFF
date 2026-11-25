const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const repo=path.resolve(__dirname,'../../../..'),r=path.resolve(process.argv[2]);
const ts=require(repo+'/wms/node_modules/typescript');
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
const prefix='modules/marketplace-connections/',service=prefix+'marketplace-connections.service.js';
let text=fs.readFileSync(r+'/candidate/'+service,'utf8');
// FIX: exact guarded overlay; all unrelated live service code must remain byte-for-byte intact.
const anchor='            const orders = await (0, wb_label_orders_1.wbLabelOrders)(this.prisma, clientId, selections, fetchWildberriesFbsHistory, marketplaceJson);';
assert.equal(text.split(anchor).length,2,'live selected-label anchor drift');
assert(!text.includes('ozonLabelOrders'));
text=text.replace(anchor,'            const ozonOrders = await require("./ozon-label-orders").ozonLabelOrders(this.prisma, clientId, selections, marketplaceJson);\n            if (ozonOrders) return { orders: ozonOrders };\n'+anchor);
fs.mkdirSync(r+'/api/'+prefix,{recursive:true});fs.writeFileSync(r+'/api/'+service,text);fs.writeFileSync(r+'/candidate/'+service,text);
const helper=prefix+'ozon-label-orders.js',compiled=compile(fs.readFileSync(repo+'/wms/apps/api/src/modules/marketplace-connections/ozon-label-orders.ts','utf8'));
for(const target of ['api','candidate'])fs.writeFileSync(r+'/'+target+'/'+helper,compiled);
fs.mkdirSync(r+'/web',{recursive:true});fs.writeFileSync(r+'/api-changes.json',JSON.stringify([service,helper]));fs.writeFileSync(r+'/web-changes.json','[]');
console.log('Guarded API2 overlay; web unchanged');

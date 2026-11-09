'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const patches=require('./prepare.cjs');
const root=path.resolve(process.argv[2]),source=path.resolve('apps/api/src'),read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const base=path.join(root,'api-base'),candidate=path.join(root,'api-candidate');fs.cpSync(base,candidate,{recursive:true});
function once(s,a,b){assert.equal(s.split(a).length,2,a.slice(0,100));return s.replace(a,b)}
for(const [file,fn]of [['warehouse/fabric-rolls.js',patches.patchRolls],['warehouse/fabric-shipment-accounting.js',patches.patchAccounting],['warehouse/warehouse.module.js',patches.patchWarehouseModule],['marketplace-connections/marketplace-connections.service.js',patches.patchMarketplace],['marketplace-connections/fbs-fabric-reservation.js',patches.patchReservation]])write(path.join(candidate,'modules',file),fn(read(path.join(base,'modules',file))));
for(const name of ['fabric-catalog','fabric-catalog.controller'])write(path.join(candidate,'modules/warehouse',name+'.js'),ts.transpileModule(read(path.join(source,'modules/warehouse',name+'.ts')),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText);
let availability=read(path.join(base,'modules/warehouse/fabric-fbs-availability.js'));
availability=once(availability,'function identifyFabricSku(sku) {','function identifyFabricSku(sku) {\n const b=require("./fabric-catalog").readFabricBinding(sku.marketplacePayload);if(b)return {skuId:sku.id,material:b.material,color:b.color,lengthMm:b.lengthMm};');
write(path.join(candidate,'modules/warehouse/fabric-fbs-availability.js'),availability);
const adminFile='modules/administration/administration-internal-api.service.js';let admin=read(path.join(base,adminFile));
admin=once(admin,'exports.INTERNAL_API_DEFINITIONS = Object.freeze([','exports.INTERNAL_API_DEFINITIONS = Object.freeze(['+JSON.stringify({id:'fabric-catalog',name:'Ткани — цвета и привязки',prefixes:['/warehouse/fabric-catalog/:clientId'],routeCount:2,description:'Цвета ткани клиента и точный метраж товаров маркетплейса.',logic:['Права клиента и филиала.','Цвет до привязки SKU.','Существующая привязка неизменна.'],dependencies:['Основная БД','WMS_FBS_FABRIC_CUT_ENABLED']})+',');write(path.join(candidate,adminFile),admin);
const files=[];function walk(dir){for(const n of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,n.name);if(n.isDirectory())walk(p);else{const rel=path.relative(candidate,p).replaceAll('\\','/');if(!fs.existsSync(path.join(base,rel))||!fs.readFileSync(p).equals(fs.readFileSync(path.join(base,rel))))files.push(rel)}}}walk(candidate);
for(const file of files){assert.equal(ts.createSourceFile(file,read(path.join(candidate,file)),99,true,ts.ScriptKind.JS).parseDiagnostics.length,0);write(path.join(root,'api-payload',file),fs.readFileSync(path.join(candidate,file)))}
write(path.join(root,'api-changes.json'),JSON.stringify(files));console.log('API candidate',files);

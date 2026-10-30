// TEST: inspect and invoke the actual candidate modules, including Nest route metadata.
require('reflect-metadata');
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const root=process.argv[2]||'/app/apps/api/dist';
const {InventoryController}=require(root+'/modules/inventory/inventory.controller');
const {ConfirmFoundUnitDto}=require(root+'/modules/inventory/dto/inventory.dto');
const {validate}=require('class-validator');
const {confirmFoundUnit}=require(root+'/modules/inventory/found-unit-review');
const {requireKnownFboKiz}=require(root+'/modules/tsd/fbo-known-kiz');
(async()=>{
 process.env.WMS_INVENTORY_FOUND_UNIT_ENABLED='true';
 assert.equal(Reflect.getMetadata('path',InventoryController.prototype.confirmFoundUnit),'boxes/:id/found-unit');
 assert.equal(Reflect.getMetadata('design:paramtypes',InventoryController.prototype,'confirmFoundUnit')[1],ConfirmFoundUnitDto);
 assert((await validate(Object.assign(new ConfirmFoundUnitDto(),{kiz:123,reason:123,confirmed:'yes'}))).length===3);
 assert.throws(()=>requireKnownFboKiz(undefined));requireKnownFboKiz({id:'known'});
 await assert.rejects(()=>confirmFoundUnit({},'audit',{kiz:'x',reason:'reason',confirmed:true},{roleCodes:['WORKER']}));
 const fbo=fs.readFileSync(root+'/modules/tsd/fbo-two-stage.service.js','utf8');
 assert(fbo.includes('require("./fbo-known-kiz").requireKnownFboKiz(previous)'));
 assert(fbo.indexOf('requireKnownFboKiz(previous)')>fbo.indexOf('async bindPickedMark('));
 const service=fs.readFileSync(root+'/modules/inventory/inventory.service.js','utf8');
 assert(service.includes('canConfirmFoundUnit:')&&service.includes('runSerializableInventoryDecision(tx =>'));
 const admin=fs.readFileSync(root+'/modules/administration/administration.service.js','utf8');
 assert(admin.includes('preserveBoxReview ? client_1.InventorySessionStatus.REVIEW'));
 process.env.WMS_INVENTORY_FOUND_UNIT_ENABLED='false';requireKnownFboKiz(undefined);
 console.log(JSON.stringify({passed:10,actualRuntime:true}));
})().catch(e=>{console.error(e);process.exit(1)});

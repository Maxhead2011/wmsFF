// TEST: validate wiring and disabled behavior in the actual published candidate, without writes.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('path');require('reflect-metadata');
const root=process.env.RUNTIME_ROOT;const {KizFoundReview}=require(path.join(root,'modules/inventory/kiz-found-review'));
const {KizFoundReviewController}=require(path.join(root,'modules/inventory/kiz-found-review.controller'));
const {InventoryModule}=require(path.join(root,'modules/inventory/inventory.module'));
test('found controller is wired and exposes authenticated GET/POST',()=>{assert.ok(Reflect.getMetadata('controllers',InventoryModule).includes(KizFoundReviewController));assert.equal(Reflect.getMetadata('path',KizFoundReviewController),'inventory/kiz-found');assert.equal(Reflect.getMetadata('method',KizFoundReviewController.prototype.act),1);});
test('disabled found workflow cannot touch data',async()=>{process.env.WMS_KIZ_FOUND_REVIEW_ENABLED='false';const s=new KizFoundReview({}, {},()=>{throw Error('must not inspect');});await assert.rejects(s.act({action:'OPEN',confirmed:true,reason:'found'},{roleCodes:['ADMIN']}));});
test('boxless shipped lookup offers an explicit review and is still read only',async()=>{
 const {KizLocationService}=require(path.join(root,'modules/inventory/kiz-location.service'));process.env.WMS_KIZ_FOUND_REVIEW_ENABLED='true';process.env.WMS_KIZ_LOCATION_CHECK_ENABLED='true';process.env.WMS_KIZ_REVIEW_QUEUE_ENABLED='false';process.env.WMS_KIZ_REUSE_EVIDENCE_ENABLED='false';
 const value='0104640569959539215eCUd%lbPYtuV';const db={productMark:{findMany:async()=>[{id:'m',value,clientId:'c',status:'SHIPPING',box:null,stockMovement:{warehouseId:'w'},sku:{name:'Test'},client:{name:'Client'}}]}};
 const result=await new KizLocationService(db,{resolveClientFilter:()=> 'c'}).lookup(value,{roleCodes:['ADMIN'],permissionCodes:[],activeWarehouseId:'w',warehouseIds:['w']});assert.deepEqual(result.foundCandidate,{markId:'m',identity:value});
});

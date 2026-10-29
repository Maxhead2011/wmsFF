// TEST: load the actual patched controller and exercise replay without booting or writing business data.
require('reflect-metadata');
const assert=require('node:assert/strict'),path=require('node:path');
const root=process.argv[2],{TsdDeviceController}=require(path.join(root,'modules/tsd/tsd-device.controller.js'));
const {PATH_METADATA,METHOD_METADATA}=require('@nestjs/common/constants');
const {TsdOperationLogService}=require(path.join(root,'modules/tsd/tsd-operation-log.service.js'));
process.env.WMS_KIZ_CLIENT_GUARD_ENABLED='true';let passed=0;
const handler=TsdDeviceController.prototype.queueReceiptKizReview;
assert.equal(Reflect.getMetadata(PATH_METADATA,handler),'receipts/kiz-review');assert.equal(Reflect.getMetadata(METHOD_METADATA,handler),1);passed++;
assert.deepEqual(Reflect.getMetadata('design:paramtypes',TsdDeviceController.prototype,'queueReceiptKizReview'),[Object,Object]);passed++;
const log=new TsdOperationLogService({});
const op={operationKey:'existing',operationType:'receipt_scan',deviceCode:'device',payload:{clientId:'client'}};
const result=log.existingResult(op,{status:'ACCEPTED',reviewReason:null,payload:{_kizDuplicate:{code:'KIZ_DUPLICATE',duplicate:true,duplicateInfo:{firstBoxCode:'SECRET'}}}});
assert.equal(result.status,'ALREADY_APPLIED');assert.equal(result.duplicateInfo,undefined);passed++;
console.log(JSON.stringify({passed,actualRuntime:true,syntheticOnly:true}));

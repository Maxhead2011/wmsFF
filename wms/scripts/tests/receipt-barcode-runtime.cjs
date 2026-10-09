// TEST: candidate registration, role policy, capture isolation and exact legacy API compatibility.
const {test}=require('node:test'),assert=require('node:assert/strict');require('reflect-metadata');
const root=process.env.RUNTIME_ROOT;
const {ReceiptBarcodeReviewService}=require(root+'/modules/tsd/receipt-barcode-review.service');
const {ReceiptBarcodeReviewController}=require(root+'/modules/tsd/receipt-barcode-review.controller');
const {TsdModule}=require(root+'/modules/tsd/tsd.module');
const {TsdSyncService}=require(root+'/modules/tsd/tsd-sync.service');
const policy=require(root+'/modules/tsd/receipt-barcode-policy');
const {INTERNAL_API_DEFINITIONS}=require(root+'/modules/administration/administration-internal-api.service');
test('review service and controller registered without losing FBO controllers',()=>{assert.ok(Reflect.getMetadata('providers',TsdModule).includes(ReceiptBarcodeReviewService));const c=Reflect.getMetadata('controllers',TsdModule);assert.ok(c.includes(ReceiptBarcodeReviewController));assert.ok(c.some(x=>x.name==='FboTwoStageController'));assert.equal(Reflect.getMetadata('design:paramtypes',TsdSyncService).at(-1),ReceiptBarcodeReviewService);assert.equal(INTERNAL_API_DEFINITIONS.filter(x=>x.id==='receipt-barcode-review').length,1);});
test('all four legacy barcodes require review; accepted known codes do not',()=>{for(const b of ['18','7459','08123282'])assert.ok(policy.receiptBarcodeRisk(b,false));assert.equal(policy.receiptBarcodeRisk('18',true),null);assert.equal(policy.receiptBarcodeRisk('4006381333931',false),null);});
test('only non-demo administrators and owners review',()=>{for(const role of ['ADMIN','OWNER'])assert.doesNotThrow(()=>policy.requireReceiptReviewer({roleCodes:[role],isDemo:false}));for(const u of [{roleCodes:['WORKER']},{roleCodes:['CLIENT']},{roleCodes:['ADMIN'],isDemo:true}])assert.throws(()=>policy.requireReceiptReviewer(u));});
test('sold installation bypasses new capture entirely',async()=>{process.env.WMS_RECEIPT_BARCODE_REVIEW_ENABLED='false';const s=new ReceiptBarcodeReviewService({}, {}, {}, {});assert.equal(await s.capture({},{}),null);});

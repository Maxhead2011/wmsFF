// TEST: reject drift and limit server changes to the payment confirmation method.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const{patchApi,patchWeb,method}=require('./invoice-full-receipt-release.cjs');
test('rejects drift before patching',()=>{assert.throws(()=>patchApi('drift',''),/runtime drift/);assert.throws(()=>patchWeb('drift',''),/runtime drift/);});
const base=process.argv[2],compiled=process.argv[3];
test('changes only the verified invoice confirmation method',{skip:!base},()=>{const s=fs.readFileSync(base+'/api/modules/billing/billing.service.js','utf8'),c=fs.readFileSync(compiled+'/modules/billing/billing.service.js','utf8'),r=patchApi(s,c);assert.equal(r.replace(method(r),()=>method(s)),s);assert.ok(method(r).includes('this.createPaymentLocked'));assert.ok(method(r).includes('WMS_BILLING_INVOICE_PAID_RECEIPT_ENABLED'));});

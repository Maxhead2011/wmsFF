const assert=require('node:assert/strict');
const policy=require('./dist/common/palitra-pick-kiz');
process.env.WMS_PALITRA_PICK_KIZ='true';
assert.equal(policy.palitraPickEnabled('e8597352-0b93-442c-9582-c694620a9695'),true);
assert.equal(policy.palitraPickEnabled('other'),false);
for(const name of ['tsd/fbo-unboxed-picking','tsd/fbo-two-stage.service','marketplace-connections/ozon-fbs-pick-workflow','marketplace-connections/marketplace-connections.service'])require('./dist/modules/'+name);

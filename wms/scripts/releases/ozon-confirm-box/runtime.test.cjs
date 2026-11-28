const assert = require('node:assert/strict');
const path = require('node:path');
const {assertSupplyMutable} = require(path.resolve(process.argv[2], 'modules/client-requests/ozon-supply-policy'));
// TEST: exercise the actual release module, including its require bindings.
const frozen = {frozenHash: 'frozen'};
process.env.WMS_OZON_LABEL_CONTROL_ENABLED = 'true';
assert.doesNotThrow(() => assertSupplyMutable(frozen, 'CONFIRM_BOX'));
assert.throws(() => assertSupplyMutable(frozen, 'PACK_UNIT'), {status:409});
process.env.WMS_OZON_LABEL_CONTROL_ENABLED = 'false';
assert.throws(() => assertSupplyMutable(frozen, 'CONFIRM_BOX'), {status:409});

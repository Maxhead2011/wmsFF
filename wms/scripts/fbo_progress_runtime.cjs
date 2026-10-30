// TEST: execute the candidate service with isolated in-memory persistence.
// Stock picking itself is stubbed; these assertions cover its enclosing transaction/lifecycle.
require('reflect-metadata');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = process.argv[2] || '/app/apps/api/dist';
const { FboTwoStageService } = require(root + '/modules/tsd/fbo-two-stage.service');
const unboxed = require(root + '/modules/tsd/fbo-unboxed-picking');
const { fboProgressLabels } = require(root + '/modules/tsd/fbo-progress-status');
for (const key of Object.keys(process.env)) if (key.startsWith('WMS_')) process.env[key] = 'false';
Object.assign(process.env, { WMS_FBO_TWO_STAGE_ENABLED: 'true', WMS_FBO_PROGRESS_STATUS_ENABLED: 'true', WMS_FBO_UNBOXED_PICK_ENABLED: 'true' });
let passed = 0;
async function scenario({ quantity = 1, phase = 'PICKING', fail = false, enabled = true } = {}) {
  process.env.WMS_FBO_PROGRESS_STATUS_ENABLED = String(enabled);
  const request = { id: 'r', type: 'OUTBOUND', status: 'SUBMITTED', client: { storesWithoutBoxes: true }, items: [{ id: 'i', skuId: 's', barcode: '123', quantity }], _count: { packages: 0, fbsOrderLinks: 0 } };
  const compositionHash = crypto.createHash('sha256').update(JSON.stringify([['i', 's', '123', quantity]])).digest('hex');
  let state = { request, assembly: { requestId: 'r', phase, compositionHash }, units: [], actions: {}, audits: [] };
  let locked = false;
  const service = Object.create(FboTwoStageService.prototype);
  service.lock = { assertStockMovementsAllowed: async () => {} };
  service.requireFbo = () => {};
  service.load = async tx => tx.clientRequest.findUnique({});
  service.prisma = { $transaction: async callback => {
    const working = structuredClone(state);
    const tx = {
      $queryRaw: async () => { locked = true; },
      clientRequest: { findUnique: async () => working.request, update: async ({ data }) => Object.assign(working.request, data) },
      fboAssembly: { findUnique: async () => working.assembly, update: async ({ data }) => Object.assign(working.assembly, data) },
      fboAssemblyUnit: { findMany: async () => working.units, create: async () => { assert(locked); working.units.push({ requestItemId: 'i', skuId: 's', state: 'PICKED' }); } },
      fboAssemblyAction: { findUnique: async ({ where }) => working.actions[where.id], create: async ({ data }) => { if (fail) throw new Error('transaction failure'); working.actions[data.id] = data; } },
      auditLog: { create: async ({ data }) => working.audits.push(data) },
    };
    const result = await callback(tx); state = working; return result;
  } };
  unboxed.pickUnboxed = async tx => tx.fboAssemblyUnit.create({});
  const user = { id: 'worker', roleCodes: ['WORKER'] };
  const scan = { action: 'PICK_UNIT', operationId: 'scan', barcode: '123' };
  if (fail) {
    await assert.rejects(() => service.executeAction('r', scan, user), /transaction failure/);
    assert.equal(state.units.length, 0); assert.equal(state.request.status, 'SUBMITTED'); assert.equal(state.assembly.phase, 'PICKING'); passed++;
    return;
  }
  await service.executeAction('r', scan, user);
  assert.equal(state.units.length, 1);
  assert.equal(state.request.status, enabled ? 'IN_WORK' : 'SUBMITTED');
  assert.equal(state.assembly.phase, enabled && quantity === 1 ? 'PACKING' : 'PICKING'); passed++;
  await service.executeAction('r', scan, user);
  assert.equal(state.units.length, 1); passed++;
  if (enabled && quantity === 1) {
    await service.executeAction('r', { action: 'FINISH_PICK', operationId: 'old-terminal' }, user);
    assert.equal(state.assembly.phase, 'PACKING'); assert.equal(state.request.status, 'IN_WORK'); passed++;
  }
}
(async () => {
  await scenario(); await scenario({ quantity: 2 }); await scenario({ fail: true }); await scenario({ enabled: false });
  process.env.WMS_FBO_PROGRESS_STATUS_ENABLED = 'true';
  const labels = await fboProgressLabels({ fboAssembly: { findMany: async () => [{ requestId: 'r', phase: 'PACKING', pickClosure: { version: 1, quantities: { i: 1, j: 0 } }, request: { items: [{ id: 'i', quantity: 2 }, { id: 'j', quantity: 3 }] } }] },
    fboAssemblyUnit: { groupBy: async () => [{ requestId: 'r', requestItemId: 'i', state: 'PACKED', _count: { _all: 1 } }] } }, ['r']);
  assert.equal(labels.r, 'Упаковано, ожидает проверки'); passed++;
  console.log(JSON.stringify({ passed, actualService: true, persistence: 'synthetic', productionWrites: false }));
})().catch(e => { console.error(e); process.exit(1); });

// FIX: narrowly authorized repair of request2494; no stock or packing mutations.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { fboProgressState, reconcileFboProgress } = require('/app/apps/api/dist/modules/tsd/fbo-progress-status');
const db = new PrismaClient();
(async () => {
  const apply = process.argv.includes('--apply');
  const result = await db.$transaction(async tx => {
    const request = await tx.clientRequest.findUnique({ where: { number: 2494 }, include: { items: true } });
    assert(request?.id === '2cb9f4b9-6bce-4b74-819f-e903cf0d8f6e' && request.type === 'OUTBOUND');
    await tx.$queryRaw`SELECT "id" FROM "ClientRequest" WHERE "id"=${request.id} FOR UPDATE`;
    const before = await tx.clientRequest.findUnique({ where: { id: request.id }, include: { items: true, fboAssembly: true } });
    const units = await tx.fboAssemblyUnit.findMany({ where: { requestId: request.id, state: { in: ['PICKED', 'PACKED'] } }, select: { requestItemId: true, state: true } });
    const state = fboProgressState(before.items, units);
    const repairable = ['SUBMITTED', 'APPROVED', 'IN_WORK'].includes(before.status) &&
      ['PICKING', 'PACKING', 'CONTROL'].includes(before.fboAssembly?.phase) && state.picked &&
      (before.fboAssembly.phase === 'PICKING' || before.status !== 'IN_WORK');
    if (apply && repairable) {
      assert.equal(process.env.WMS_FBO_PROGRESS_STATUS_ENABLED, 'true');
      await reconcileFboProgress(tx, request.id, null);
    }
    const after = await tx.clientRequest.findUnique({ where: { id: request.id }, include: { fboAssembly: true } });
    return { number: 2494, apply, repairable, total: before.items.reduce((s, i) => s + i.quantity, 0),
      picked: units.length, packed: units.filter(u => u.state === 'PACKED').length,
      before: { status: before.status, phase: before.fboAssembly?.phase }, after: { status: after.status, phase: after.fboAssembly?.phase }, stockMutations: false };
  }, { isolationLevel: 'Serializable' });
  console.log(JSON.stringify(result));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());

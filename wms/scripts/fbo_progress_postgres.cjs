// TEST: disposable database only; real locking, rollback and grouped Prisma reads.
const assert = require('node:assert/strict');
assert(process.env.DATABASE_URL.includes('fbo_progress_test'), 'Refuse non-test database');
const { PrismaClient } = require('@prisma/client');
const { reconcileFboProgress, fboProgressLabels } = require('/app/apps/api/dist/modules/tsd/fbo-progress-status');
const db = new PrismaClient();
process.env.WMS_FBO_PROGRESS_STATUS_ENABLED = 'true';
(async () => {
  const client = await db.client.create({ data: { code: 'FBO-PROGRESS-TEST', name: 'Synthetic' } });
  const request = await db.clientRequest.create({ data: { clientId: client.id, type: 'OUTBOUND', title: 'Synthetic', items: { create: { quantity: 2 } } }, include: { items: true } });
  await db.fboAssembly.create({ data: { requestId: request.id, compositionHash: 'test' } });
  const pick = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        await db.$transaction(async tx => {
          await tx.$queryRaw`SELECT "id" FROM "ClientRequest" WHERE "id"=${request.id} FOR UPDATE`;
          await tx.fboAssemblyUnit.create({ data: { requestId: request.id, requestItemId: request.items[0].id, skuId: 'synthetic', barcode: 'synthetic', sourceBoxId: 'synthetic', sourceBoxCode: 'synthetic', pickedByUserId: 'synthetic' } });
          await reconcileFboProgress(tx, request.id, null);
        }, { isolationLevel: 'Serializable' });
        break;
      } catch (e) { if (e.code !== 'P2034' || attempt >= 2) throw e; }
    }
  };
  await Promise.all([pick(), pick()]);
  assert.equal((await db.clientRequest.findUnique({ where: { id: request.id } })).status, 'IN_WORK');
  assert.equal((await db.fboAssembly.findUnique({ where: { requestId: request.id } })).phase, 'PACKING');
  assert.equal(await db.fboAssemblyUnit.count({ where: { requestId: request.id } }), 2);
  assert.equal(await db.auditLog.count({ where: { entityId: request.id, action: 'FBO_PROGRESS_RECONCILED' } }), 2);
  assert.equal((await fboProgressLabels(db, [request.id]))[request.id], 'В работе');
  await db.fboAssemblyUnit.updateMany({ where: { requestId: request.id }, data: { state: 'PACKED' } });
  assert.equal((await fboProgressLabels(db, [request.id]))[request.id], 'Упаковано, ожидает проверки');
  assert.equal((await db.clientRequest.findUnique({ where: { id: request.id } })).status, 'IN_WORK');
  await db.clientRequest.update({ where: { id: request.id }, data: { status: 'SUBMITTED' } });
  await db.fboAssembly.update({ where: { requestId: request.id }, data: { phase: 'PICKING' } });
  await assert.rejects(() => db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ClientRequest" WHERE "id"=${request.id} FOR UPDATE`;
    await reconcileFboProgress(tx, request.id, null); throw Error('rollback');
  }), /rollback/);
  assert.equal((await db.clientRequest.findUnique({ where: { id: request.id } })).status, 'SUBMITTED');
  assert.equal((await db.fboAssembly.findUnique({ where: { requestId: request.id } })).phase, 'PICKING');
  console.log(JSON.stringify({ passed: 9, concurrency: true, rollback: true, disposableDatabase: true }));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());

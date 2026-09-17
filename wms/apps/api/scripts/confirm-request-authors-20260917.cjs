// FIX: explicit Konstantin approval covers only requests 1034 and 1048; never infer authors from null.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { attachConfirmedRequestAuthors } = require('../dist/modules/client-requests/client-request-author');
const db = new PrismaClient();
const numbers = [1034, 1048];
const apply = process.argv.includes('--apply-confirmed-1034-1048');
(async () => {
  const result = await db.$transaction(async tx => {
    if (apply) await tx.$queryRawUnsafe('SELECT id FROM "ClientRequest" WHERE number IN (1034, 1048) ORDER BY number FOR UPDATE');
    else await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const rows = await tx.clientRequest.findMany({ where: { number: { in: numbers } }, orderBy: { number: 'asc' }, select: { id: true, number: true, title: true, createdByUserId: true } });
    assert.deepEqual(rows.map(r => r.number), numbers);
    for (const row of rows) {
      assert.equal(row.createdByUserId, null, `Request ${row.number} has a recorded human author; stop`);
      const id = `request-author-confirmed-WMS-${row.id}`;
      const existing = await tx.auditLog.findUnique({ where: { id } });
      if (existing) {
        assert.equal(existing.entityId, row.id);
        assert.equal(existing.action, 'client_request.author_confirmed');
        assert.equal(existing.payload?.author, 'WMS');
      } else if (apply) {
        await tx.auditLog.create({ data: { id, action: 'client_request.author_confirmed', entity: 'ClientRequest', entityId: row.id,
          payload: { author: 'WMS', confirmedBy: 'Константин', requestNumber: row.number, reason: 'Явное подтверждение пользователя: WMS для заявок 1034 и 1048', confirmationDate: '2026-09-17' } } });
      }
    }
    const labeled = await attachConfirmedRequestAuthors(tx, rows);
    if (apply) assert(labeled.every(r => r.creationAuthorLabel === 'WMS'));
    return { passed: true, applied: apply, requests: labeled.map(r => ({ number: r.number, author: r.creationAuthorLabel || null })), requestDataUnchanged: true };
  }, { timeout: 15000 });
  console.log(JSON.stringify(result));
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());

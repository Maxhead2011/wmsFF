// FIX: default is read-only. --apply writes only the new immutable KIZ registry.
// It never changes balances, ProductMark, shipment history, or receipt operations.
const path = require('node:path');
function evidenceCollector(identityOf) {
  const entries = new Map();
  const markCounts=new Map();
  const stats = { scanned: 0, invalid: 0, additionalEvidence: 0, markDuplicateGroups:0, markExtraRecords:0 };
  function add(row) {
    stats.scanned++;
    const identity = identityOf(row.kiz || '');
    if (!identity || !row.clientId) { stats.invalid++; return; }
    const key = JSON.stringify([row.clientId, identity]);
    if(row.origin==='mark') {const count=(markCounts.get(key)||0)+1;markCounts.set(key,count);
      if(count===2)stats.markDuplicateGroups++;if(count>1)stats.markExtraRecords++;}
    const existing = entries.get(key);
    if (existing) stats.additionalEvidence++;
    // TEST: only a verified positive receipt can supply its original date and box.
    const next = { ...row, identity, firstReceivedAt: row.proven ? row.receivedAt : null,
      firstBoxCode: row.proven ? row.boxCode || null : null, source: row.proven ? 'RECEIPT' : 'LEGACY_UNKNOWN' };
    if (!existing || (next.firstReceivedAt && (!existing.firstReceivedAt ||
      new Date(next.firstReceivedAt) < new Date(existing.firstReceivedAt)))) entries.set(key, next);
    if (entries.size > 1000000) throw Error('Backfill exceeds reviewed one-million-identity limit');
  }
  function report() { return { ...stats, identities: entries.size,
    provenReceipt: [...entries.values()].filter(r => r.firstReceivedAt).length,
    unknownReceipt: [...entries.values()].filter(r => !r.firstReceivedAt).length }; }
  return { add, entries, report };
}
async function collect(db, Prisma, identityOf) {
  const c = evidenceCollector(identityOf);
  // A receipt log and its exact movement key must agree. Edited/error-accepted rows
  // remain evidence of registration, never invented first-receipt provenance.
  let cursor = '';
  for (;;) {
    const rows = await db.$queryRaw(Prisma.sql`SELECT o.id, o."operationKey", o.payload,
      m."clientId" AS "movementClientId", m.type, m.quantity, m."createdAt" AS "receivedAt", m."skuId", m."warehouseId", m."sourceDocument",
      b.code AS "boxCode", s.name AS "productName"
      FROM "TsdOperation" o LEFT JOIN "StockMovement" m ON m."idempotencyKey"=o."operationKey"
      LEFT JOIN "Box" b ON b.id=m."boxId" LEFT JOIN "Sku" s ON s.id=m."skuId"
      WHERE o."operationType"='receipt_scan' AND o.status='ACCEPTED' AND o.id>${cursor}
      AND o.payload->>'kiz' IS NOT NULL ORDER BY o.id LIMIT 1000`);
    if (!rows.length) break;
    for (const r of rows) c.add({ ...r, clientId: r.payload.clientId, kiz: r.payload.kiz,
      barcode: r.payload.barcode || null, productName: r.payload.skuName || r.productName,
      proven: r.type === 'RECEIPT' && r.quantity === 1 && r.movementClientId === r.payload.clientId &&
        (r.boxCode || null) === (r.payload.boxCode || null) });
    cursor = rows.at(-1).id;
  }
  cursor = '';
  for (;;) {
    const rows = await db.productMark.findMany({ where: { id: { gt: cursor } }, orderBy: { id: 'asc' }, take: 1000,
      include: { stockMovement: { include: { box: { select: { code: true } } } }, sku: { select: { name: true } } } });
    if (!rows.length) break;
    for (const r of rows) {
      const m = r.stockMovement;
      const proven = m?.type === 'RECEIPT' && m.quantity === 1 && m.clientId === r.clientId &&
        m.idempotencyKey?.startsWith('receipt-import:') && m.idempotencyKey.endsWith(':' + r.value);
      c.add({ clientId: r.clientId, kiz: r.value, skuId: r.skuId, productName: r.sku?.name, origin:'mark',
        receivedAt: m?.createdAt, warehouseId: m?.warehouseId, boxCode: m?.box?.code,
        sourceDocument: m?.sourceDocument, operationKey: m?.idempotencyKey, proven });
    }
    cursor = rows.at(-1).id;
  }
  for (const table of ['shippedKizHistory', 'fbsTsdAssembly']) {
    cursor = '';
    for (;;) {
      const rows = await db[table].findMany({ where: { id: { gt: cursor }, ...(table === 'fbsTsdAssembly' ? { kiz: { not: null } } : {}) }, orderBy: { id: 'asc' }, take: 1000 });
      if (!rows.length) break;
      for (const r of rows) c.add({ clientId: r.clientId, kiz: r.kiz, productName: r.productName, skuId: r.skuId, barcode: r.barcode, proven: false });
      cursor = rows.at(-1).id;
    }
  }
  cursor = '';
  for (;;) {
    const rows = await db.$queryRaw(Prisma.sql`SELECT u.id,u.kiz,r."clientId",u."skuId",u.barcode
      FROM "FboAssemblyUnit" u JOIN "ClientRequest" r ON r.id=u."requestId"
      WHERE u.id>${cursor} AND u.kiz IS NOT NULL ORDER BY u.id LIMIT 1000`);
    if (!rows.length) break;
    for (const r of rows) c.add({ ...r, proven: false });
    cursor = rows.at(-1).id;
  }
  return c;
}
async function apply(db, Prisma, collector) {
  const rows = [...collector.entries.values()];
  for (let offset = 0; offset < rows.length; offset += 250) {
    const batch = rows.slice(offset, offset + 250).map(r => Prisma.sql`(${r.clientId},${r.identity},
      ${r.firstReceivedAt || null},${r.firstBoxCode},${r.warehouseId || null},${r.productName || null},${r.barcode || null},
      ${r.skuId || null},${r.operationKey || null},${r.sourceDocument || null},${r.source})`);
    await db.$executeRaw(Prisma.sql`INSERT INTO "KizClientRegistry"
      ("clientId",identity,"firstReceivedAt","firstBoxCode","firstWarehouseId","productName",barcode,"skuId","operationKey","sourceDocument",source)
      VALUES ${Prisma.join(batch)} ON CONFLICT ("clientId",identity) DO UPDATE SET
      "firstReceivedAt"=EXCLUDED."firstReceivedAt","firstBoxCode"=EXCLUDED."firstBoxCode","firstWarehouseId"=EXCLUDED."firstWarehouseId",
      "productName"=EXCLUDED."productName",barcode=EXCLUDED.barcode,"skuId"=EXCLUDED."skuId","operationKey"=EXCLUDED."operationKey",
      "sourceDocument"=EXCLUDED."sourceDocument",source=EXCLUDED.source
      WHERE "KizClientRegistry".source='LEGACY_UNKNOWN' AND EXCLUDED."firstReceivedAt" IS NOT NULL`);
  }
}
module.exports = { evidenceCollector, collect, apply };
if (require.main === module) {
  const { PrismaClient, Prisma } = require('@prisma/client');
  const { clientKizIdentity } = require(path.join(process.env.KIZ_RUNTIME_ROOT || '/app/apps/api/dist', 'common/kiz-client-registry.js'));
  const db = new PrismaClient();
  (async () => { const c = await collect(db, Prisma, clientKizIdentity); if (process.argv.includes('--apply')) await apply(db, Prisma, c);
    console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'applied-registry-only' : 'dry-run', ...c.report() }));
  })().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
}

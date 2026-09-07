// FIX: one-off, frozen-scope maintenance. No stock, KIZ, request or application-code writes.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const RUN = 'empty-pallet-boxes-20260907-1744';
const WAREHOUSE = 'afb244a1-50ae-4ae6-9111-afe85949fa58';
const ADMIN = 'b045e060-dfd7-48af-bb88-12c191ee8eae';
const terminal = ['DONE', 'CANCELLED', 'REJECTED'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function validateManifest(m) {
  if (m?.runId !== RUN || m?.warehouseId !== WAREHOUSE || m.rows?.length !== 272 ||
      new Set(m.rows.map(r => r.code)).size !== 272 ||
      m.rows.some(r => !/^FFL_[A-Z0-9_]+$/.test(r.code) || !/^PALET_SORT_\d+$/.test(r.pallet))) {
    throw Error('Invalid frozen 272-box manifest');
  }
}

function reasons(s) {
  const out = [...s.references]; const b = s.box;
  if (!b) return [...out, 'BOX_MISSING'];
  if (s.permanent) out.push('PERMANENT_STORAGE');
  if (b.warehouseId !== s.warehouseId) out.push('WAREHOUSE_CHANGED');
  if (b.status !== 'active') out.push('BOX_STATUS:' + b.status);
  if (b.balances.some(v => v.quantity !== 0)) out.push('NONZERO_BALANCE');
  if (b.productMarks.some(v => v.status !== 'SHIPPING')) out.push('NON_HISTORICAL_KIZ');
  const p = b.storagePlacement?.pallet;
  if (!p || p.code !== s.expectedPallet || p.warehouseId !== s.warehouseId || p.status === 'deleted') out.push('PLACEMENT_CHANGED');
  return [...new Set(out)].sort();
}

async function collect(db, manifest, policy) {
  const codes = manifest.rows.map(r => r.code);
  const boxes = await db.box.findMany({ where: { code: { in: codes } }, include: {
    balances: { orderBy: { id: 'asc' } },
    productMarks: { select: { id: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } },
    storagePlacement: { include: { pallet: { select: { code: true, status: true, warehouseId: true } } } },
  } });
  const ids = boxes.map(b => b.id); const refs = new Map(codes.map(c => [c, []]));
  const byId = new Map(boxes.map(b => [b.id, b.code]));
  const add = (id, why) => { const code = byId.get(id) || id; if (refs.has(code)) refs.get(code).push(why); };
  // FIX: preserve unfinished work, even if its reservation is inconsistent with stock.
  const assemblies = await db.fbsTsdAssembly.findMany({ where: {
    status: { notIn: ['COMPLETED', 'CANCELLED', 'SHIPPED', 'RETURNED'] },
    OR: [{ boxId: { in: ids } }, { reservedBoxId: { in: ids } }, { boxCode: { in: codes } }, { reservedBoxCode: { in: codes } }],
  }, select: { id: true, boxId: true, reservedBoxId: true, boxCode: true, reservedBoxCode: true } });
  for (const row of assemblies) for (const id of [row.boxId, row.reservedBoxId, row.boxCode, row.reservedBoxCode]) add(id, 'FBS:' + row.id);
  const selections = await db.clientRequestBoxSelection.findMany({ where: { boxId: { in: ids },
    requestItem: { request: { status: { notIn: terminal } } } }, select: { boxId: true, requestItemId: true } });
  for (const row of selections) add(row.boxId, 'REQUEST_SELECTION:' + row.requestItemId);
  const collections = await db.skuCollectionSource.findMany({ where: { sourceBoxId: { in: ids },
    request: { status: { notIn: terminal } } }, select: { sourceBoxId: true, requestId: true } });
  for (const row of collections) add(row.sourceBoxId, 'SKU_COLLECTION:' + row.requestId);
  const inventories = await db.inventoryAuditBox.findMany({ where: { boxId: { in: ids },
    session: { status: { in: ['ACTIVE', 'REVIEW'] } } }, select: { boxId: true, sessionId: true } });
  for (const row of inventories) add(row.boxId, 'INVENTORY:' + row.sessionId);
  const full = await db.inventorySession.findFirst({ where: { type: 'FULL', status: { in: ['ACTIVE', 'REVIEW'] } }, select: { id: true } });
  if (full) for (const code of codes) add(code, 'FULL_INVENTORY:' + full.id);
  const rescans = await db.inventoryBoxRescanRequest.findMany({ where: { boxId: { in: ids }, consumedAt: null,
    status: { notIn: ['REJECTED', 'CANCELLED', 'CONSUMED'] } }, select: { id: true, boxId: true } });
  for (const row of rescans) add(row.boxId, 'RESCAN:' + row.id);
  const waves = await db.pickWave.findMany({ where: { status: { notIn: ['DONE', 'CANCELLED'] } },
    select: { id: true, plan: true, balanceLines: { select: { sourceBoxId: true, sourceBoxCode: true } } } });
  const transfers = await db.interWarehouseTransfer.findMany({ where: { status: { notIn: ['RECEIVED', 'CANCELLED', 'REJECTED'] } },
    select: { id: true, sourceBoxCodes: true, destinationBoxCode: true, manifest: true } });
  const reviews = await db.tsdOperation.findMany({ where: { status: 'NEEDS_REVIEW', reviewedAt: null },
    select: { id: true, payload: true } });
  const printJobs = await db.printJob.findMany({ where: { status: { in: ['queued', 'processing', 'pending', 'printing'] } },
    select: { id: true, payload: true } });
  // FIX: conservative JSON-reference matching includes nested source/target boxes and print payloads.
  for (const [kind, records] of [['PICK_WAVE', waves], ['TRANSFER', transfers], ['TSD_REVIEW', reviews], ['PRINT', printJobs]]) {
    for (const record of records) {
      const data = JSON.stringify(record).toUpperCase();
      for (const box of boxes) if (data.includes(box.code.toUpperCase()) || data.includes(box.id.toUpperCase())) add(box.id, kind + ':' + record.id);
    }
  }
  const map = new Map(boxes.map(b => [b.code, b])); const result = [];
  for (const row of manifest.rows) result.push({ code: row.code, expectedPallet: row.pallet, warehouseId: manifest.warehouseId,
    permanent: await policy(row.code), references: [...new Set(refs.get(row.code))].sort(), box: map.get(row.code) || null });
  return result;
}

async function applyOne(db, approved, runId, userId, reread, detach) {
  const auditId = runId + ':' + approved.box.id;
  if (await db.auditLog.findUnique({ where: { id: auditId } })) return { code: approved.code, status: 'ALREADY_APPLIED' };
  const fresh = await reread(); const blocked = reasons(fresh);
  if (blocked.length) return { code: approved.code, status: 'SKIPPED', reasons: blocked };
  // FIX: dates serialize identically from the saved preview and live Prisma records.
  if (digest(fresh) !== digest(approved)) return { code: approved.code, status: 'SKIPPED', reasons: ['SNAPSHOT_CHANGED'] };
  const b = fresh.box;
  const updated = await db.box.updateMany({ where: { id: b.id, status: 'active', warehouseId: fresh.warehouseId,
    balances: { none: { quantity: { not: 0 } } }, productMarks: { none: { status: { not: 'SHIPPING' } } } },
    data: { status: 'archived', zoneId: null, palletId: null } });
  if (updated.count !== 1) throw Error('Concurrent box modification');
  const detached = await detach.detachIfArchivedAndEmpty({ boxId: b.id, userId, reason: runId }, db);
  if (!detached.detached) throw Error('Canonical detach failed; rollback required');
  await db.auditLog.create({ data: { id: auditId, userId, action: 'APPROVED_EMPTY_BOX_ARCHIVED', entity: 'Box', entityId: b.id,
    payload: { runId, code: b.code, before: JSON.parse(JSON.stringify(b)), stockChanged: false, kizChanged: false,
      after: { status: 'archived', zoneId: null, palletId: null, storagePlacement: null } } } });
  return { code: b.code, status: 'ARCHIVED', pallet: fresh.expectedPallet };
}

async function main() {
  const [mode, manifestFile, snapshotFile, expectedDigest] = process.argv.slice(2);
  if (!['preview', 'apply'].includes(mode) || !manifestFile || !snapshotFile) throw Error('Use preview|apply manifest.json snapshot.json [digest]');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); validateManifest(manifest);
  const root = '/app/apps/api';
  const { PrismaClient } = require(root + '/node_modules/@prisma/client');
  const { BoxCodePolicyService, preserveEmptyStorageBox } = require(root + '/dist/common/boxes/box-code-policy.service');
  const { SystemSettingsService } = require(root + '/dist/common/settings/system-settings.service');
  const { ArchivedEmptyBoxPalletDetachService } = require(root + '/dist/common/boxes/archived-empty-box-pallet-detach.service');
  if (process.env.WMS_PERMANENT_STORAGE_BOXES_ENABLED !== 'true') throw Error('Not the approved WMSFF2207 environment');
  const db = new PrismaClient();
  const transaction = fn => db.$transaction(fn, { isolationLevel: 'Serializable', timeout: 120000, maxWait: 10000 });
  const policyFor = tx => { const service = new BoxCodePolicyService(new SystemSettingsService(tx)); return code => preserveEmptyStorageBox(code, service); };
  try {
    const admin = await db.user.findUnique({ where: { id: ADMIN }, select: { status: true, roles: { select: { role: { select: { code: true } } } } } });
    if (admin?.status !== 'ACTIVE' || !admin.roles.some(r => r.role.code === 'ADMIN')) throw Error('Approved administrator is not active');
    if (mode === 'preview') {
      const states = await transaction(async tx => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return collect(tx, manifest, policyFor(tx)); });
      const snapshot = { runId: RUN, manifestDigest: digest(manifest), checkedAt: new Date().toISOString(), states };
      const output = { ...snapshot, digest: digest(snapshot), eligible: states.filter(s => reasons(s).length === 0).length };
      fs.mkdirSync(path.dirname(snapshotFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(snapshotFile, JSON.stringify(output), { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ mode, count: states.length, eligible: output.eligible, skipped: states.length - output.eligible,
        digest: output.digest, reasons: states.reduce((a,s) => { for (const r of reasons(s)) { const k = r.split(':')[0]; a[k] = (a[k] || 0) + 1; } return a; }, {}) }));
      return;
    }
    const saved = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    const { digest: savedDigest, eligible, ...snapshot } = saved;
    if (!expectedDigest || savedDigest !== expectedDigest || digest(snapshot) !== expectedDigest || saved.manifestDigest !== digest(manifest)) throw Error('Preview digest mismatch');
    if (Date.now() - Date.parse(saved.checkedAt) > 30 * 60 * 1000) throw Error('Preview expired');
    const results = [];
    for (const approved of saved.states) {
      const blocked = reasons(approved);
      if (blocked.length) { results.push({ code: approved.code, pallet: approved.expectedPallet, status: 'SKIPPED', reasons: blocked }); continue; }
      const result = await transaction(async tx => {
        await tx.$queryRawUnsafe('SELECT id FROM "Box" WHERE id = $1 FOR UPDATE', approved.box.id);
        const codes = new BoxCodePolicyService(new SystemSettingsService(tx));
        const r = await applyOne(tx, approved, RUN, ADMIN, async () => (await collect(tx,
          { ...manifest, rows: [{ code: approved.code, pallet: approved.expectedPallet }] }, code => preserveEmptyStorageBox(code, codes)))[0],
          new ArchivedEmptyBoxPalletDetachService(tx, codes));
        if (r.status === 'ARCHIVED') {
          const after = await tx.box.findUnique({ where: { id: approved.box.id }, include: {
            balances: { orderBy: { id: 'asc' } }, productMarks: { select: { id: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } }, storagePlacement: true } });
          if (after.status !== 'archived' || after.storagePlacement || digest(after.balances) !== digest(approved.box.balances) ||
              digest(after.productMarks) !== digest(approved.box.productMarks)) throw Error('Postcondition failed; rollback');
        }
        return r;
      });
      results.push(result);
      console.log(JSON.stringify(result));
    }
    fs.writeFileSync(snapshotFile + '.result.json', JSON.stringify({ completedAt: new Date().toISOString(), runId: RUN, results }), { mode: 0o600 });
    console.log(JSON.stringify({ summary: results.reduce((a,r) => (a[r.status] = (a[r.status] || 0) + 1, a), {}) }));
  } finally { await db.$disconnect(); }
}
module.exports = { reasons, applyOne, validateManifest };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });

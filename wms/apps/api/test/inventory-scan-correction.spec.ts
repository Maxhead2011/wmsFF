import { afterEach, expect, it, vi } from 'vitest';
import { InventoryService } from '../src/modules/inventory/inventory.service';
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('WMS_INVENTORY_SCAN_CORRECTION_ENABLED', 'true');
  const rows: any[] = [], logs = new Map<string, any>();
  const box = { id: 'audit', boxId: 'box', boxCode: '160', clientId: 'client', clientName: 'client', sessionId: 'session', startedAt: new Date('2026-09-18'), status: 'COUNTING', session: { status: 'ACTIVE' } };
  const user: any = { id: 'owner', roleCodes: ['OWNER'], permissionCodes: ['system:admin'] };
  const db: any = {
    inventoryAuditBox: { findUnique: async () => box, updateMany: async () => ({ count: 1 }) },
    sku: { findFirst: async ({ where }: any) => ({ id: where.barcodes.some.value, name: where.barcodes.some.value, internalSku: 'sku', needsChestnyZnak: true }) },
    inventoryAuditLine: {
      findUnique: async ({ where }: any) => rows.find(r => where.id ? r.id === where.id : r.skuId === where.auditBoxId_skuId.skuId) ?? null,
      create: async ({ data }: any) => { const r = { id: data.skuId, ...data }; rows.push(r); return r; },
      update: async ({ where, data }: any) => { const r = rows.find(r => r.id === where.id); r.countedQuantity += data.countedQuantity.increment ?? -data.countedQuantity.decrement; r.difference = data.difference; return r; },
    },
    auditLog: {
      findUnique: async ({ where }: any) => logs.get(where.id) ?? null,
      create: vi.fn(async ({ data }: any) => { const row = { id: data.id ?? 'correction-' + logs.size, ...data }; logs.set(row.id, row); return row; }),
      update: async ({ where, data }: any) => { const r = logs.get(where.id); Object.assign(r, data); return r; },
    },
  };
  db.$transaction = async (fn: any) => { const savedRows = structuredClone(rows), savedLogs = structuredClone([...logs]); try { return await fn(db); } catch (e) { rows.splice(0, rows.length, ...savedRows); logs.clear(); savedLogs.forEach(([k,v]: any) => logs.set(k,v)); throw e; } };
  const service = new InventoryService(db, { requireClientAccess: vi.fn() } as any, {} as any);
  const scan = (barcode: string, extra = {}, actor = user) => service.scanItem('audit', { barcode, captureKiz: true, allowScanCorrection: true, kiz: '010460000000000121SERIAL0000001\u001d91TEST\u001d92CRYPTO', ...extra }, actor);
  return { rows, logs, db, box, scan, user };
}
it('prompts before changing a saved pair, then transfers exactly one count and audits the original scan', async () => {
  // TEST: owner confirms Мото after accidentally scanning its KIZ against Лондон in box 160.
  const f = fixture(); await f.scan('111');
  const prompt: any = await f.scan('222'); expect(prompt.scanState).toBe('SCAN_CONFLICT');
  expect(f.rows.reduce((n,r) => n+r.countedQuantity,0)).toBe(1);
  await f.scan('222', { replaceEvidenceToken: prompt.replaceEvidenceToken });
  await f.scan('222', { replaceEvidenceToken: prompt.replaceEvidenceToken });
  expect(f.rows.map(r => [r.skuId,r.countedQuantity])).toEqual([['111',0],['222',1]]);
  expect([...f.logs.values()].filter(r => r.action === 'INVENTORY_KIZ_SCAN_CORRECTED')).toHaveLength(1);
  expect([...f.logs.values()].find(r => r.action === 'INVENTORY_KIZ_SCAN').payload.skuId).toBe('222');
});
it.each(['worker','demo','flag-off','old-client','stale-token','new-round','audit-failure'])('does not partially change a scan: %s', async kind => {
  // TEST: role, explicit opt-in, compare-and-set token, and rollback are enforced server-side.
  const f=fixture(); await f.scan('111'); const prompt: any = await f.scan('222');
  let actor=f.user; const extra: any={replaceEvidenceToken:prompt.replaceEvidenceToken};
  if(kind==='worker')actor={...actor,roleCodes:['TSD']};
  if(kind==='demo')actor={...actor,isDemo:true};
  if(kind==='flag-off')vi.stubEnv('WMS_INVENTORY_SCAN_CORRECTION_ENABLED','false');
  if(kind==='old-client')extra.allowScanCorrection=false;
  if(kind==='stale-token')extra.replaceEvidenceToken='stale';
  if(kind==='new-round')f.box.startedAt=new Date('2026-09-19');
  if(kind==='audit-failure')f.db.auditLog.create.mockRejectedValue(Error('audit unavailable'));
  await expect(f.scan('222',extra,actor)).rejects.toThrow();
  expect(f.rows).toHaveLength(1);expect(f.rows[0].countedQuantity).toBe(1);
  expect([...f.logs.values()][0].payload.skuId).toBe('111');
});

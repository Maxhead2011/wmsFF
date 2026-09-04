import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../src/modules/inventory/inventory.service';

const barcode = '2045143989162';
const kiz = '010460000000000121SERIAL0000001\u001d91TEST\u001d92CRYPTO';
const user = { id: 'worker', name: 'Worker', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], deviceCode: 'TSD' } as any;

function fixture() {
  let line: any = null;
  const logs = new Map<string, any>();
  const box = { id: 'audit', boxId: 'physical-box', boxCode: 'FFL_TEST', clientId: 'client',
    sessionId: 'session', startedAt: new Date('2026-09-04T12:00:00Z'), status: 'COUNTING',
    session: { warehouseId: 'warehouse', status: 'ACTIVE' } };
  const sku = { id: 'sku', name: 'Костюм', internalSku: 'SKU', needsChestnyZnak: true,
    isUnmarked: false, barcodes: [{ value: barcode, isPrimary: true }] };
  const db = {
    inventoryAuditBox: { findUnique: vi.fn(async () => box), updateMany: vi.fn(async () => ({ count: 1 })) },
    sku: { findFirst: vi.fn(async (): Promise<any> => sku) },
    inventoryAuditLine: {
      findUnique: vi.fn(async () => line),
      create: vi.fn(async ({ data }: any) => line = { id: 'line', ...data }),
      update: vi.fn(async ({ data }: any) => line = { ...line,
        countedQuantity: line.countedQuantity + data.countedQuantity.increment, difference: data.difference }),
    },
    productMark: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    stockBalance: { update: vi.fn() },
    auditLog: {
      findUnique: vi.fn(async ({ where }: any) => logs.get(where.id) ?? null),
      create: vi.fn(async ({ data }: any) => { logs.set(data.id, data); return data; }),
    },
    $transaction: vi.fn(async (fn: any) => {
      const saved = line && { ...line }; const oldLogs = new Map(logs);
      try { return await fn(db); } catch (e) { line = saved; logs.clear(); oldLogs.forEach((v, k) => logs.set(k, v)); throw e; }
    }),
  };
  const scopes = { requireClientAccess: vi.fn() };
  return { db, box, sku, scopes, logs, line: () => line,
    service: new InventoryService(db as any, scopes as any, {} as any) };
}

// TEST: physically observed KIZ is count evidence, not a mutation of stock or order ownership.
describe('inventory barcode + KIZ counting', () => {
  it('asks for KIZ after barcode without incrementing a marked product', async () => {
    const f = fixture();
    await expect(f.service.scanItem('audit', { barcode, captureKiz: true } as any, user))
      .resolves.toMatchObject({ scanState: 'SCAN_KIZ', barcode });
    expect(f.line()).toBeNull();
    expect(f.logs.size).toBe(0);
  });
  it('records full KIZ, user, barcode and box; counts one even when the old binding is wrong/missing', async () => {
    const f = fixture();
    await expect(f.service.scanItem('audit', { barcode, kiz, captureKiz: true } as any, user))
      .resolves.toMatchObject({ countedQuantity: 1, scanState: 'COUNTED' });
    expect([...f.logs.values()][0]).toMatchObject({ userId: 'worker', action: 'INVENTORY_KIZ_SCAN',
      payload: { kiz, skuId: 'sku', barcode, boxId: 'physical-box' } });
    expect(f.db.stockBalance.update).not.toHaveBeenCalled();
    expect(f.db.productMark.update).not.toHaveBeenCalled();
    expect(f.db.productMark.create).not.toHaveBeenCalled();
  });
  it('does not recount a repeated KIZ or one with a different crypto tail', async () => {
    const f = fixture(); const dto = { barcode, kiz, captureKiz: true } as any;
    await f.service.scanItem('audit', dto, user);
    await expect(f.service.scanItem('audit', { ...dto, kiz: kiz.replace('CRYPTO', 'OTHER') }, user))
      .resolves.toMatchObject({ countedQuantity: 1, duplicate: true });
    expect(f.logs.size).toBe(1);
  });
  it('rejects the same KIZ paired with another SKU within the counting round', async () => {
    const f = fixture(); const dto = { barcode, kiz, captureKiz: true } as any;
    await f.service.scanItem('audit', dto, user); f.sku.id = 'another';
    await expect(f.service.scanItem('audit', dto, user)).rejects.toThrow();
    expect(f.line().countedQuantity).toBe(1);
  });
  it('allows recounting the physical KIZ in an explicitly reopened counting round', async () => {
    const f = fixture(); const dto = { barcode, kiz, captureKiz: true } as any;
    await f.service.scanItem('audit', dto, user);
    f.box.startedAt = new Date('2026-09-04T13:00:00Z');
    await f.service.scanItem('audit', dto, user);
    expect(f.logs.size).toBe(2);
  });
  it.each([{ kiz: barcode }, { kiz, quantity: 2 }])('rejects malformed/bulk KIZ scan: %j', async extra => {
    const f = fixture();
    await expect(f.service.scanItem('audit', { barcode, captureKiz: true, ...extra } as any, user)).rejects.toThrow();
    expect(f.line()).toBeNull();
  });
  it('rolls back count if saving scan evidence fails', async () => {
    const f = fixture(); f.db.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(f.service.scanItem('audit', { barcode, kiz, captureKiz: true } as any, user)).rejects.toThrow('audit unavailable');
    expect(f.line()).toBeNull();
  });
  it('does not count if the box was finished concurrently', async () => {
    const f = fixture(); f.db.inventoryAuditBox.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.service.scanItem('audit', { barcode, kiz, captureKiz: true } as any, user)).rejects.toThrow();
    expect(f.line()).toBeNull();
  });
  it('preserves barcode-only counting and counts unmarked goods without asking for KIZ', async () => {
    const f = fixture();
    await expect(f.service.scanItem('audit', { barcode, quantity: 3 }, user)).resolves.toMatchObject({ countedQuantity: 3 });
    f.sku.isUnmarked = true;
    await expect(f.service.scanItem('audit', { barcode, captureKiz: true } as any, user)).resolves.toMatchObject({ countedQuantity: 4 });
    expect(f.logs.size).toBe(0);
  });
  it('retains client access checks before recording any physical evidence', async () => {
    const f = fixture(); f.scopes.requireClientAccess.mockImplementation(() => { throw new Error('denied'); });
    await expect(f.service.scanItem('audit', { barcode, kiz, captureKiz: true } as any, user)).rejects.toThrow('denied');
    expect(f.logs.size).toBe(0);
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import { InventoryService } from '../src/modules/inventory/inventory.service';
afterEach(() => vi.unstubAllEnvs());
function setup() {
  vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED', 'true');
  const db = { systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: { required: true } }) },
    sku: { findFirst: vi.fn().mockResolvedValue({ id: 'sku', needsChestnyZnak: false, isUnmarked: true, barcodes: [] }) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
    inventoryAuditLine: { findMany: vi.fn().mockResolvedValue([{ skuId: 'sku', countedQuantity: 35 }]), findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue({ id: 'line', expectedQuantity: 0 }), create: vi.fn(), update: vi.fn() } };
  const service = new InventoryService(db as never, { requireClientAccess: vi.fn() } as never, {} as never);
  vi.spyOn(service as any, 'requireCountingBox').mockResolvedValue({ clientId: 'client', startedAt: new Date(), session: {} });
  return { db, service };
}
it('requires KIZ for inventory despite stale SKU flags and omitted scanner capture flag', async () => {
  // TEST: client policy must override per-card and scanner defaults.
  const { db, service } = setup();
  expect(await service.scanItem('box', { barcode: '123', requireKiz: false } as any, {} as any)).toMatchObject({ scanState: 'SCAN_KIZ' });
  expect(db.inventoryAuditLine.create).not.toHaveBeenCalled();
});
it('cannot finish old counts without KIZ evidence after the policy is enabled', async () => {
  // TEST: previously manually counted units cannot bypass the new rule on finish.
  const { db, service } = setup();
  await expect(service.finishBox('box', {} as any)).rejects.toThrow('Количество не подтверждено');
  expect(db.inventoryAuditLine.update).not.toHaveBeenCalled();
});
it('blocks manual inventory quantities from bypassing required KIZ scans', async () => {
  // TEST: the alternate count endpoint cannot add unscanned units.
  const { db, service } = setup();
  await expect(service.setCount('box', { lineId: 'line', countedQuantity: 35 }, {} as any)).rejects.toThrow();
  expect(db.inventoryAuditLine.update).not.toHaveBeenCalled();
});

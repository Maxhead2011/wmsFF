import { afterEach, expect, it, vi } from 'vitest';
import { TsdAssemblyService } from '../src/modules/tsd/tsd-assembly.service';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
afterEach(() => vi.unstubAllEnvs());
it('prompts for KIZ for unknown barcodes without creating catalog or stock rows', async () => {
  // TEST: 404 used to admit an unknown barcode as an unmarked draft on the TSD.
  vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED', 'true');
  const db = { barcode: { findMany: vi.fn().mockResolvedValue([]) }, systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: { required: true } }) } };
  const service = new TsdAssemblyService(db as any, { requireClientAccess: vi.fn() } as any, {} as any, {} as any, {} as any);
  expect(await service.findSkuByBarcode({ clientId: 'c', barcode: '4630584395559' }, { permissionCodes: ['system:admin'], roleCodes: ['ADMIN'] } as any))
    .toMatchObject({ id: null, isDraft: true, needsChestnyZnak: true, isUnmarked: false });
  db.systemSetting.findUnique.mockResolvedValue(null as any);
  await expect(service.findSkuByBarcode({ clientId: 'other', barcode: '123' }, { permissionCodes: ['system:admin'], roleCodes: ['ADMIN'] } as any)).rejects.toThrow();
});
it('blocks missing KIZ in the actual receipt mutation even with accept-with-error', async () => {
  // TEST: neither offline payload nor administrator error acceptance skips the rule.
  vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED', 'true');
  const tx: any = { stockMovement: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: { required: true } }) } };
  const service: any = Object.create(StockOperationsService.prototype);
  Object.assign(service, { clientScopes: { requireClientAccess: vi.fn() }, resolveWritableWarehouseId: () => 'wh',
    resolveOrCreateSkuForReceipt: vi.fn(), prisma: { $transaction: (fn: any) => fn(tx) } });
  await expect(service.receiveIntoBox({ clientId: 'c', barcode: '123', quantity: 35, idempotencyKey: 'scan', allowReceiptError: true }, { id: 'u' })).rejects.toThrow('КИЗ обязателен');
  expect(service.resolveOrCreateSkuForReceipt).not.toHaveBeenCalled();
  expect(tx.stockMovement.create).not.toHaveBeenCalled();
  tx.stockMovement.findUnique.mockResolvedValue({ id: 'already' });
  expect(await service.receiveIntoBox({ clientId: 'c', idempotencyKey: 'scan' }, { id: 'u' })).toMatchObject({ status: 'ALREADY_APPLIED' });
});

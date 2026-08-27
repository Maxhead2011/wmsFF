import { describe, expect, it, vi } from 'vitest';
import { AdministrationTechnicalWorkService } from '../src/modules/administration/administration-technical-work.service';

describe('AdministrationTechnicalWorkService box mutation lock', () => {
  // TEST: technical placement locks the Box row before revalidation and cannot race retirement.
  it('блокирует строку короба до размещения на паллет-сорт', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'box-1' }]),
      box: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'box-1', status: 'active', clientId: 'client-1', warehouseId: 'warehouse-1' },
        ]),
      },
      storagePallet: {
        upsert: vi.fn().mockResolvedValue({
          id: 'pallet-1',
          code: 'PALLET-1',
          clientId: 'client-1',
          warehouseId: 'warehouse-1',
        }),
      },
      storagePalletBox: { upsert: vi.fn().mockResolvedValue({ id: 'placement-1' }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AdministrationTechnicalWorkService(
      prisma as never,
      {} as never,
      { repairFbsRequestSelection: vi.fn() } as never,
      {} as never,
      { refreshRequestInstruction: vi.fn() } as never,
    );
    vi.spyOn(service, 'previewPalletSortScan').mockResolvedValue({
      pallet: {
        code: 'PALLET-1',
        client: { id: 'client-1', code: 'CLIENT', name: 'Клиент' },
        warehouse: { id: 'warehouse-1', code: 'MSK', city: 'Москва' },
      },
      boxes: [{ boxId: 'box-1', code: 'FFL_BOX_1', action: 'PLACE' }],
      errors: [],
      affectedRequests: [],
      summary: { place: 1, move: 0, unchanged: 0, affectedRequests: 0 },
      canApply: true,
      confirmation: 'РАЗМЕСТИТЬ',
    } as never);

    await service.applyPalletSortScan(
      { palletCode: 'PALLET-1', boxCodes: ['FFL_BOX_1'], confirmation: 'РАЗМЕСТИТЬ' },
      { id: 'admin-1', name: 'Администратор', administrationEnabled: true } as never,
    );

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.storagePalletBox.upsert).toHaveBeenCalledOnce();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.storagePalletBox.upsert.mock.invocationCallOrder[0],
    );
  });
});

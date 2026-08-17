import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdministrationTechnicalWorkService } from '../src/modules/administration/administration-technical-work.service';

describe('AdministrationTechnicalWorkService: confirmation boundary', () => {
  const owner = {
    id: 'owner-1',
    administrationEnabled: true,
    isDemo: false,
  } as never;

  function setup() {
    const prisma = {
      fbsTsdAssembly: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'task-1', requestId: 'request-1', status: 'RETURN_REQUIRED' })
          .mockResolvedValueOnce({ status: 'RETURNED' }),
      },
    };
    const auditLog = { write: vi.fn().mockResolvedValue(undefined) };
    const marketplaceConnections = {
      resolveFbsSyncConflict: vi.fn().mockResolvedValue({ message: 'Решение применено.' }),
    };
    const service = new AdministrationTechnicalWorkService(
      prisma as never,
      auditLog as never,
      marketplaceConnections as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, auditLog, marketplaceConnections };
  }

  // ADDED: A direct request cannot bypass the confirmation shown by the web UI.
  it.each([
    ['RETURN_TO_STOCK', '', 'ВЕРНУТЬ'],
    ['MANAGER_CONFIRMED', 'неверная фраза', 'ПОДТВЕРДИТЬ'],
  ])('не применяет %s без точной фразы подтверждения', async (action, confirmation, expected) => {
    const { service, prisma, marketplaceConnections } = setup();

    await expect(service.apply({
      issueId: 'STATUS:request-1:task-1',
      action,
      confirmation,
      comment: 'Проверено менеджером',
    }, owner)).rejects.toThrow(new BadRequestException(`Подтвердите действие словом «${expected}».`));

    expect(prisma.fbsTsdAssembly.findUnique).not.toHaveBeenCalled();
    expect(marketplaceConnections.resolveFbsSyncConflict).not.toHaveBeenCalled();
  });

  // ADDED: The valid phrase reaches the existing repair exactly once and is verified afterward.
  it('применяет возврат при точном подтверждении', async () => {
    const { service, auditLog, marketplaceConnections } = setup();

    const result = await service.apply({
      issueId: 'STATUS:request-1:task-1',
      action: 'RETURN_TO_STOCK',
      confirmation: '  вернуть  ',
    }, owner);

    expect(marketplaceConnections.resolveFbsSyncConflict).toHaveBeenCalledTimes(1);
    expect(marketplaceConnections.resolveFbsSyncConflict).toHaveBeenCalledWith(
      'request-1',
      'task-1',
      { action: 'RETURN_TO_STOCK', comment: undefined },
      owner,
    );
    expect(auditLog.write).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ applied: true, verified: true }));
  });

  // ADDED: An unavailable route audit must never be rendered as an empty healthy result.
  it('не скрывает сбой анализа маршрута сообщением об отсутствии проблем', async () => {
    const auditFailure = new Error('База временно недоступна');
    const service = new AdministrationTechnicalWorkService(
      {} as never,
      {} as never,
      {} as never,
      {
        listActiveRequests: vi.fn().mockResolvedValue([{ id: 'request-1' }]),
        auditRequest: vi.fn().mockRejectedValue(auditFailure),
      } as never,
      {} as never,
    );

    await expect(service.diagnose('REQUESTS', owner)).rejects.toBe(auditFailure);
  });

  const scannerOwner = {
    id: 'owner-1',
    name: 'Владелец',
    administrationEnabled: true,
    isDemo: false,
    clientScopeMode: 'ALL',
    writableClientIds: [],
    writableWarehouseIds: [],
  } as never;

  // ADDED: Preview rejects a mixed physical scan before any placement can be written.
  it('не смешивает короба разных клиентов или складов при восстановлении палет-сорта', async () => {
    const prisma = {
      box: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'box-1', code: 'BOX-1', status: 'active', clientId: 'client-1', warehouseId: 'wh-1',
            client: { id: 'client-1', code: 'C1', name: 'Клиент 1' },
            warehouse: { id: 'wh-1', code: 'W1', name: 'Склад 1' }, storagePlacement: null,
          },
          {
            id: 'box-2', code: 'BOX-2', status: 'active', clientId: 'client-2', warehouseId: 'wh-2',
            client: { id: 'client-2', code: 'C2', name: 'Клиент 2' },
            warehouse: { id: 'wh-2', code: 'W2', name: 'Склад 2' }, storagePlacement: null,
          },
        ]),
      },
      storagePallet: { findUnique: vi.fn() },
    };
    const service = new AdministrationTechnicalWorkService(
      prisma as never, {} as never, {} as never, {} as never, {} as never,
    );

    const preview = await service.previewPalletSortScan({
      palletCode: 'PALET_SORT_001',
      boxCodes: ['BOX-1', 'BOX-2'],
    }, scannerOwner);

    expect(preview.canApply).toBe(false);
    expect(preview.errors).toContainEqual(expect.objectContaining({ message: expect.stringContaining('нельзя смешивать') }));
    expect(prisma.storagePallet.findUnique).not.toHaveBeenCalled();
  });

  // ADDED: Confirmation is checked before preview or transaction work.
  it('не размещает отсканированные короба без точного подтверждения', async () => {
    const prisma = { $transaction: vi.fn() };
    const service = new AdministrationTechnicalWorkService(
      prisma as never, {} as never, {} as never, {} as never, {} as never,
    );
    const preview = vi.spyOn(service, 'previewPalletSortScan');

    await expect(service.applyPalletSortScan({
      palletCode: 'PALET_SORT_001',
      boxCodes: ['BOX-1'],
      confirmation: 'ИСПРАВИТЬ',
    }, scannerOwner)).rejects.toThrow('Подтвердите действие словом «РАЗМЕСТИТЬ».');

    expect(preview).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ADDED: A confirmed scan writes only placement records and its audit entry.
  it('атомарно сохраняет фактически отсканированное размещение без изменения остатков', async () => {
    const tx = {
      box: {
        findMany: vi.fn().mockResolvedValue([{ id: 'box-1', status: 'active', clientId: 'client-1', warehouseId: 'wh-1' }]),
      },
      storagePallet: {
        upsert: vi.fn().mockResolvedValue({ id: 'pallet-1', code: 'PALET_SORT_001', clientId: 'client-1', warehouseId: 'wh-1' }),
      },
      storagePalletBox: { upsert: vi.fn().mockResolvedValue({ id: 'placement-1' }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
      stockBalance: { updateMany: vi.fn() },
      productMark: { updateMany: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new AdministrationTechnicalWorkService(
      prisma as never, {} as never, {} as never, {} as never, {} as never,
    );
    vi.spyOn(service, 'previewPalletSortScan').mockResolvedValue({
      checkedAt: new Date().toISOString(),
      pallet: {
        id: null, code: 'PALET_SORT_001', exists: false, willCreate: true,
        client: { id: 'client-1', code: 'C1', name: 'Клиент 1' },
        warehouse: { id: 'wh-1', code: 'W1', name: 'Склад 1' },
      },
      boxes: [{ code: 'BOX-1', boxId: 'box-1', currentPalletCode: null, action: 'PLACE' }],
      affectedRequests: [], errors: [],
      summary: { requested: 1, place: 1, move: 0, unchanged: 0, affectedRequests: 0 },
      canApply: true, confirmation: 'РАЗМЕСТИТЬ',
    });

    const result = await service.applyPalletSortScan({
      palletCode: 'PALET_SORT_001', boxCodes: ['BOX-1'], confirmation: 'разместить',
    }, scannerOwner);

    expect(result).toEqual(expect.objectContaining({ applied: true, placed: 1 }));
    expect(tx.storagePalletBox.upsert).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.stockBalance.updateMany).not.toHaveBeenCalled();
    expect(tx.productMark.updateMany).not.toHaveBeenCalled();
  });

  // ADDED: A box changed after preview aborts the whole placement transaction.
  it('останавливает размещение, если короб изменился после предварительной проверки', async () => {
    const tx = {
      box: { findMany: vi.fn().mockResolvedValue([{ id: 'box-1', status: 'archived', clientId: 'client-1', warehouseId: 'wh-1' }]) },
      storagePallet: { upsert: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new AdministrationTechnicalWorkService(
      prisma as never, {} as never, {} as never, {} as never, {} as never,
    );
    vi.spyOn(service, 'previewPalletSortScan').mockResolvedValue({
      checkedAt: new Date().toISOString(),
      pallet: {
        id: null, code: 'PALET_SORT_001', exists: false, willCreate: true,
        client: { id: 'client-1', code: 'C1', name: 'Клиент 1' },
        warehouse: { id: 'wh-1', code: 'W1', name: 'Склад 1' },
      },
      boxes: [{ code: 'BOX-1', boxId: 'box-1', currentPalletCode: null, action: 'PLACE' }],
      affectedRequests: [], errors: [],
      summary: { requested: 1, place: 1, move: 0, unchanged: 0, affectedRequests: 0 },
      canApply: true, confirmation: 'РАЗМЕСТИТЬ',
    });

    await expect(service.applyPalletSortScan({
      palletCode: 'PALET_SORT_001', boxCodes: ['BOX-1'], confirmation: 'РАЗМЕСТИТЬ',
    }, scannerOwner)).rejects.toThrow('Один из коробов изменился после проверки');

    expect(tx.storagePallet.upsert).not.toHaveBeenCalled();
  });
});

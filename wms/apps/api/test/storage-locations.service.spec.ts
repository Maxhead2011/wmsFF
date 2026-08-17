import { describe, expect, it, vi } from 'vitest';
import { StorageLocationsService } from '../src/modules/warehouse/storage-locations.service';

describe('StorageLocationsService', () => {
  it('rejects a box code when the TSD expects a pallet-sort code', async () => {
    const prisma = {
      box: {
        findFirst: vi.fn().mockResolvedValue({ code: 'FFL_LKB25_032' }),
      },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    await expect(
      (service as any).assertPalletCodeIsNotBoxCode('FFL_LKB25_032'),
    ).rejects.toThrow('Сейчас требуется QR или ШК паллетсорта');
  });

  it('switches the TSD to content recovery when a scanned box is missing', async () => {
    const openPallet = {
      id: 'pallet-1',
      code: 'PALET_SORT_001',
      clientId: 'client-1',
      status: 'OPEN',
      client: { id: 'client-1', code: 'CLIENT', name: 'Клиент' },
      zone: null,
      boxes: [],
    };
    const prisma = {
      storagePallet: {
        findUnique: vi.fn().mockResolvedValue(openPallet),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    const result = await service.scanTsdPalletBox(
      'pallet-1',
      { boxCode: 'FFL_MISSING_001' },
      { id: 'worker-1', name: 'Сборщик' } as never,
    );

    expect(result).toMatchObject({
      state: 'SCAN_BOX_CONTENTS',
      duplicate: false,
      recovery: {
        boxCode: 'FFL_MISSING_001',
        reason: 'MISSING',
      },
      pallet: {
        id: 'pallet-1',
        code: 'PALET_SORT_001',
      },
    });
  });

  it('moves a box to another pallet and writes an audit event', async () => {
    const sourcePlacement = placement('placement-a', 'FFL_BOX_001', 'pallet-a', 'PALLET_A');
    const targetPallet = pallet('pallet-b', 'PALLET_B');
    const update = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      storagePalletBox: {
        findUnique: vi.fn(({ where }: { where: { boxCode: string } }) =>
          Promise.resolve(where.boxCode === sourcePlacement.boxCode ? sourcePlacement : null),
        ),
        update,
      },
      storagePallet: {
        findUnique: vi.fn().mockResolvedValue(targetPallet),
      },
      auditLog: {
        create: auditCreate,
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    const result = await service.relocateBox(
      { boxCode: sourcePlacement.boxCode, targetPalletId: targetPallet.id },
      { id: 'admin-1', name: 'Администратор' } as never,
    );

    expect(result).toMatchObject({
      mode: 'MOVED',
      boxCode: 'FFL_BOX_001',
      fromPallet: { code: 'PALLET_A' },
      toPallet: { code: 'PALLET_B' },
      swappedBoxCode: null,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'placement-a' },
        data: expect.objectContaining({ palletId: 'pallet-b', source: 'MANUAL' }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'STORAGE_PALLET_BOX_RELOCATED', userId: 'admin-1' }),
      }),
    );
  });

  it('swaps two boxes between pallets atomically', async () => {
    const sourcePlacement = placement('placement-a', 'FFL_BOX_001', 'pallet-a', 'PALLET_A');
    const swapPlacement = placement('placement-b', 'FFL_BOX_002', 'pallet-b', 'PALLET_B');
    const targetPallet = pallet('pallet-b', 'PALLET_B');
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      storagePalletBox: {
        findUnique: vi.fn(({ where }: { where: { boxCode: string } }) =>
          Promise.resolve(
            where.boxCode === sourcePlacement.boxCode
              ? sourcePlacement
              : where.boxCode === swapPlacement.boxCode
                ? swapPlacement
                : null,
          ),
        ),
        update,
      },
      storagePallet: {
        findUnique: vi.fn().mockResolvedValue(targetPallet),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    const result = await service.relocateBox(
      {
        boxCode: sourcePlacement.boxCode,
        targetPalletId: targetPallet.id,
        swapBoxCode: swapPlacement.boxCode,
      },
      { id: 'admin-1', name: 'Администратор' } as never,
    );

    expect(result).toMatchObject({
      mode: 'SWAPPED',
      boxCode: 'FFL_BOX_001',
      swappedBoxCode: 'FFL_BOX_002',
    });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls.map(([call]) => call.data.palletId)).toEqual(['pallet-b', 'pallet-a']);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'STORAGE_PALLET_BOXES_SWAPPED',
          payload: expect.objectContaining({ swapBoxCode: 'FFL_BOX_002' }),
        }),
      }),
    );
  });

  it('deletes an empty pallet and writes an audit event', async () => {
    const emptyPallet = {
      ...pallet('pallet-empty', 'PALLET_EMPTY'),
      zoneId: 'zone-1',
      source: 'MANUAL',
      status: 'CLOSED',
      boxes: [],
    };
    const prisma = {
      storagePallet: {
        findUnique: vi.fn().mockResolvedValue(emptyPallet),
        delete: vi.fn().mockResolvedValue(emptyPallet),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    await expect(
      service.deletePallet('pallet-empty', { id: 'admin-1', name: 'Администратор' } as never),
    ).resolves.toEqual({
      id: 'pallet-empty',
      code: 'PALLET_EMPTY',
      deleted: true,
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'STORAGE_PALLET_DELETED',
          entityId: 'pallet-empty',
          userId: 'admin-1',
        }),
      }),
    );
    expect(prisma.storagePallet.delete).toHaveBeenCalledWith({ where: { id: 'pallet-empty' } });
  });

  it('does not delete a pallet that still contains boxes', async () => {
    const occupiedPallet = {
      ...pallet('pallet-full', 'PALLET_FULL'),
      zoneId: 'zone-1',
      source: 'MANUAL',
      status: 'CLOSED',
      boxes: [{ boxCode: 'FFL_BOX_001' }],
    };
    const prisma = {
      storagePallet: {
        findUnique: vi.fn().mockResolvedValue(occupiedPallet),
      },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    await expect(
      service.deletePallet('pallet-full', { id: 'admin-1', name: 'Администратор' } as never),
    ).rejects.toThrow('Сначала перенесите их на другую паллету');
  });
});

function pallet(id: string, code: string) {
  return {
    id,
    code,
    clientId: 'client-1',
    warehouseId: 'warehouse-1',
  };
}

function placement(id: string, boxCode: string, palletId: string, palletCode: string) {
  return {
    id,
    boxId: `box-${id}`,
    boxCode,
    source: 'TSD',
    palletId,
    pallet: pallet(palletId, palletCode),
  };
}

function boxCodePolicy() {
  return {
    getPolicy: vi.fn().mockResolvedValue({ allowedPrefixes: ['FFL_'] }),
    normalize: vi.fn(async (value: string) => value.trim().toUpperCase()),
    requireAllowed: vi.fn(async (value: string) => value.trim().toUpperCase()),
  };
}

function balances() {
  return {
    balanceKey: vi.fn((input: Record<string, unknown>) =>
      [input.clientId, input.skuId, input.boxId ?? 'no-box', input.palletId ?? 'no-pallet', input.status].join(':'),
    ),
  };
}

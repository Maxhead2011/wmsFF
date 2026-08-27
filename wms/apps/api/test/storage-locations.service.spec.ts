import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageLocationsService } from '../src/modules/warehouse/storage-locations.service';

describe('StorageLocationsService', () => {
  afterEach(() => vi.unstubAllGlobals());

  // TEST: ordinary MANUAL/TSD placement takes the shared Box lock before writing the pallet-sort link.
  it('блокирует активный короб до размещения на паллет-сорте', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{
        id: 'box-active',
        status: 'active',
        clientId: 'client-1',
        warehouseId: 'warehouse-1',
      }]),
      storagePalletBox: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({
          id: 'placement-1',
          boxId: 'box-active',
          boxCode: 'FFL_ACTIVE_001',
          palletId: 'pallet-1',
          box: { id: 'box-active', status: 'active' },
          pallet: { id: 'pallet-1' },
        }),
      },
      storagePallet: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    await (service as any).placeBox(
      { id: 'pallet-1', code: 'PALLET-1', clientId: 'client-1', warehouseId: 'warehouse-1' },
      'FFL_ACTIVE_001',
      'MANUAL',
      { id: 'admin-1', name: 'Администратор', permissionCodes: ['system:admin'] },
    );

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.storagePalletBox.upsert).toHaveBeenCalledOnce();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.storagePalletBox.upsert.mock.invocationCallOrder[0],
    );
  });

  // TEST: архивный короб после административного списания нельзя вернуть на паллет-сорт обычным сканом.
  it('не размещает архивный короб на паллет-сорте', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: 'box-archived',
          status: 'archived',
          clientId: 'client-1',
          warehouseId: 'warehouse-1',
        },
      ]),
      storagePalletBox: { findUnique: vi.fn(), upsert: vi.fn() },
      storagePallet: { update: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
      storagePalletBox: { findUnique: vi.fn(), upsert: vi.fn() },
      box: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'box-archived',
          status: 'archived',
          clientId: 'client-1',
          warehouseId: 'warehouse-1',
        }),
      },
      storagePallet: { update: vi.fn() },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    await expect(
      (service as any).placeBox(
        { id: 'pallet-1', code: 'PALLET-1', clientId: 'client-1', warehouseId: 'warehouse-1' },
        'FFL_ARCHIVED_001',
        'TSD',
        { id: 'admin-1', name: 'Администратор', permissionCodes: ['system:admin'] },
      ),
    ).rejects.toThrow('архив');

    expect(tx.storagePalletBox.upsert).not.toHaveBeenCalled();
    expect(tx.storagePallet.update).not.toHaveBeenCalled();
  });

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

  // ADDED: Google data was a one-time migration source; ordinary layout reads
  // must never trigger the legacy fetch or rewrite its derived placements.
  it('does not sync or mutate Google-derived data when listLayout receives sync=true', async () => {
    const { fetchGoogle, googleWrites, prisma } = googleMigrationHarness();
    vi.stubGlobal('fetch', fetchGoogle);
    const service = new StorageLocationsService(
      prisma as never,
      boxCodePolicy() as never,
      balances() as never,
    );
    const syncGoogleSheet = vi.spyOn(service, 'syncGoogleSheet');

    const layout = await service.listLayout(
      'warehouse-1',
      undefined,
      true,
      googleMigrationAdmin(),
    );

    expect.soft(syncGoogleSheet).not.toHaveBeenCalled();
    expect.soft(fetchGoogle).not.toHaveBeenCalled();
    expect.soft(googleWrites.deleteMany).not.toHaveBeenCalled();
    expect.soft(googleWrites.palletUpsert).not.toHaveBeenCalled();
    expect.soft(googleWrites.placementUpsert).not.toHaveBeenCalled();
    expect.soft(layout.googleSync.lastAttemptAt).toBeNull();
  });

  // ADDED: even an explicit legacy-sync request must stop before external I/O
  // or Prisma mutations and explain that only the one-time migration is allowed.
  it('rejects explicit Google sync before fetch or Prisma writes', async () => {
    const { fetchGoogle, googleWrites, prisma } = googleMigrationHarness();
    vi.stubGlobal('fetch', fetchGoogle);
    const service = new StorageLocationsService(
      prisma as never,
      boxCodePolicy() as never,
      balances() as never,
    );
    let syncError: unknown;

    try {
      await service.syncGoogleSheet(
        undefined,
        true,
        'client-1',
        googleMigrationAdmin(),
      );
    } catch (caught) {
      syncError = caught;
    }

    const message = syncError instanceof Error ? syncError.message : '';
    expect.soft(message).toMatch(/отключен/i);
    expect.soft(message).toMatch(/одноразов.*миграц/i);
    expect.soft(fetchGoogle).not.toHaveBeenCalled();
    expect.soft(googleWrites.deleteMany).not.toHaveBeenCalled();
    expect.soft(googleWrites.palletUpsert).not.toHaveBeenCalled();
    expect.soft(googleWrites.placementUpsert).not.toHaveBeenCalled();
    expect.soft(googleWrites.warehouseCreate).not.toHaveBeenCalled();
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

function googleMigrationAdmin() {
  return {
    id: 'admin-1',
    name: 'Администратор',
    roleCodes: ['ADMIN'],
    permissionCodes: ['system:admin'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  } as never;
}

function googleMigrationHarness() {
  const fetchGoogle = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue('PALET_SORT_001\nFFL_BOX_001'),
  });
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const palletUpsert = vi.fn().mockResolvedValue({
    id: 'pallet-google-1',
    source: 'GOOGLE_SHEETS',
  });
  const placementUpsert = vi.fn().mockResolvedValue({});
  const warehouseCreate = vi.fn().mockResolvedValue({ id: 'warehouse-created' });
  const tx = {
    storagePalletBox: { upsert: placementUpsert },
    box: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const prisma = {
    warehouse: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'warehouse-1',
        code: 'MSK',
        name: 'Москва',
      }),
      create: warehouseCreate,
    },
    client: {
      findUnique: vi.fn().mockResolvedValue({ id: 'client-1' }),
      findFirst: vi.fn().mockResolvedValue({ id: 'client-1' }),
    },
    box: { findMany: vi.fn().mockResolvedValue([]) },
    storagePalletBox: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany,
    },
    storagePallet: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: palletUpsert,
    },
    zone: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
  };
  return {
    fetchGoogle,
    googleWrites: { deleteMany, palletUpsert, placementUpsert, warehouseCreate },
    prisma,
  };
}

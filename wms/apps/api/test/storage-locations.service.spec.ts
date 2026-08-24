import { describe, expect, it, vi } from 'vitest';
import { StorageLocationsService } from '../src/modules/warehouse/storage-locations.service';

describe('StorageLocationsService', () => {
  it('counts pallets and boxes for every storage zone', async () => {
    const warehouse = { id: 'warehouse-1', code: 'SPB', name: 'Склад' };
    const prisma = {
      warehouse: { findUnique: vi.fn().mockResolvedValue(warehouse) },
      storagePallet: {
        findMany: vi.fn().mockResolvedValue([
          { ...pallet('pallet-a', 'PALLET_A'), zoneId: 'zone-1', boxes: [{ id: 'box-a' }, { id: 'box-b' }], lastSyncedAt: null },
          { ...pallet('pallet-b', 'PALLET_B'), zoneId: 'zone-1', boxes: [{ id: 'box-c' }], lastSyncedAt: null },
          { ...pallet('pallet-c', 'PALLET_C'), zoneId: null, boxes: [{ id: 'box-d' }], lastSyncedAt: null },
        ]),
      },
      zone: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'zone-1', warehouseId: warehouse.id, code: 'ZONE-001', name: 'Основная зона' },
          { id: 'zone-2', warehouseId: warehouse.id, code: 'ZONE-002', name: 'Резерв' },
        ]),
      },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    const result = await service.listLayout(warehouse.id, undefined, false, adminUser());

    expect(result.zones).toEqual([
      expect.objectContaining({ id: 'zone-1', palletCount: 2, boxCount: 3 }),
      expect.objectContaining({ id: 'zone-2', palletCount: 0, boxCount: 0 }),
    ]);
    expect(result.summary).toEqual(expect.objectContaining({ pallets: 3, boxes: 4, unassignedPallets: 1 }));
  });

  // TEST: Google synchronization must not leave a reattached archived-empty box on a pallet-sort.
  it('runs the shared archived-empty rule after Google placement synchronization', async () => {
    const detachIfArchivedAndEmpty = vi.fn().mockResolvedValue({ detached: true });
    const prisma = {
      box: {
        findMany: vi.fn()
          .mockResolvedValueOnce([
            { id: 'box-archived', code: 'FFL_ARCHIVED_001', status: 'active' },
          ])
          .mockResolvedValueOnce([{ id: 'box-archived' }]),
      },
      storagePalletBox: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({ id: 'placement-1' }),
      },
      storagePallet: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({
          id: 'pallet-1',
          code: 'PALET_SORT_001',
          source: 'GOOGLE_SHEETS',
        }),
      },
      $transaction: vi.fn(async (operation: unknown) =>
        typeof operation === 'function'
          ? (operation as (tx: typeof prisma) => Promise<unknown>)(prisma)
          : Promise.all(operation as Array<Promise<unknown>>)),
    };
    const service = new StorageLocationsService(
      prisma as never,
      boxCodePolicy() as never,
      balances() as never,
      { detachIfArchivedAndEmpty } as never,
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('PALET_SORT_001\nFFL_ARCHIVED_001\n'),
    }));

    try {
      await (service as any).performGoogleSync('warehouse-1', 'client-1');
    } finally {
      vi.unstubAllGlobals();
    }

    expect(detachIfArchivedAndEmpty).toHaveBeenCalledWith(
      { boxId: 'box-archived', reason: 'google-storage-layout-sync' },
      prisma,
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    // TEST: transactional status re-read catches active -> archived races.
    expect(prisma.box.findMany).toHaveBeenCalledTimes(2);
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
      warehouseId: 'warehouse-1',
      status: 'OPEN',
      client: { id: 'client-1', code: 'CLIENT', name: 'Клиент' },
      zone: null,
      boxes: [],
    };
    const prisma = {
      storagePallet: {
        findUnique: vi.fn().mockResolvedValue(openPallet),
      },
      storagePalletBox: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    const result = await service.scanTsdPalletBox(
      'pallet-1',
      { boxCode: 'FFL_MISSING_001' },
      adminUser('worker-1'),
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
      adminUser(),
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
      adminUser(),
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
      service.deletePallet('pallet-empty', adminUser()),
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
      service.deletePallet('pallet-full', adminUser()),
    ).rejects.toThrow('Сначала перенесите их на другую паллету');
  });

  it('limits the storage layout to the active branch and readable clients', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      warehouse: {
        findUnique: vi.fn().mockResolvedValue({ id: 'warehouse-1', code: 'SPB', name: 'Филиал' }),
      },
      storagePallet: { findMany },
      zone: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);
    const user = branchUser();

    await service.listLayout('warehouse-1', undefined, false, user);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          warehouseId: 'warehouse-1',
          clientId: { in: ['client-1'] },
        }),
      }),
    );
    await expect(service.listLayout('warehouse-2', undefined, false, user)).rejects.toThrow(
      'Данные другого филиала недоступны',
    );
  });

  it('does not let a branch manager create a pallet for a foreign client', async () => {
    const upsert = vi.fn();
    const prisma = {
      warehouse: {
        findUnique: vi.fn().mockResolvedValue({ id: 'warehouse-1', code: 'SPB', name: 'Филиал' }),
      },
      client: {
        findUnique: vi.fn().mockResolvedValue({ id: 'client-2' }),
      },
      storagePallet: { upsert },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    await expect(
      service.createPallet(
        { warehouseId: 'warehouse-1', clientId: 'client-2', code: 'PALLET_002' },
        branchUser(),
      ),
    ).rejects.toThrow('Клиент не относится к выбранному филиалу');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('blocks mutations of a pallet from another branch', async () => {
    const update = vi.fn();
    const prisma = {
      storagePallet: {
        findUnique: vi.fn().mockResolvedValue({
          ...pallet('pallet-foreign', 'PALLET_FOREIGN'),
          warehouseId: 'warehouse-2',
        }),
        update,
      },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    await expect(service.updatePallet('pallet-foreign', { status: 'CLOSED' }, branchUser())).rejects.toThrow(
      'Данные другого филиала недоступны',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('does not move a box away from a pallet in another branch', async () => {
    const targetPallet = pallet('pallet-target', 'PALLET_TARGET');
    const foreignPlacement = {
      ...placement('placement-foreign', 'FFL_BOX_900', 'pallet-foreign', 'PALLET_FOREIGN'),
      pallet: {
        ...pallet('pallet-foreign', 'PALLET_FOREIGN'),
        warehouseId: 'warehouse-2',
      },
    };
    const upsert = vi.fn();
    const prisma = {
      storagePallet: { findUnique: vi.fn().mockResolvedValue(targetPallet) },
      storagePalletBox: {
        findUnique: vi.fn().mockResolvedValue(foreignPlacement),
        upsert,
      },
      box: { findUnique: vi.fn() },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    await expect(
      service.addBox(targetPallet.id, { boxCode: 'FFL_BOX_900' }, branchUser()),
    ).rejects.toThrow('Данные другого филиала недоступны');
    expect(upsert).not.toHaveBeenCalled();
    expect(prisma.box.findUnique).not.toHaveBeenCalled();
  });

  it('does not place an unassigned box from another branch on the active pallet', async () => {
    const targetPallet = pallet('pallet-target', 'PALLET_TARGET');
    const upsert = vi.fn();
    const prisma = {
      storagePallet: { findUnique: vi.fn().mockResolvedValue(targetPallet) },
      storagePalletBox: { findUnique: vi.fn().mockResolvedValue(null), upsert },
      box: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'box-foreign',
          code: 'FFL_BOX_902',
          status: 'active',
          clientId: 'client-1',
          warehouseId: 'warehouse-2',
        }),
      },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    await expect(
      service.addBox(targetPallet.id, { boxCode: 'FFL_BOX_902' }, branchUser()),
    ).rejects.toThrow('другому филиалу');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('blocks TSD recovery before changing a box placed in another branch', async () => {
    const activePallet = { ...pallet('pallet-active', 'PALLET_ACTIVE'), status: 'OPEN' };
    const foreignPlacement = {
      ...placement('placement-foreign', 'FFL_BOX_901', 'pallet-foreign', 'PALLET_FOREIGN'),
      pallet: {
        ...pallet('pallet-foreign', 'PALLET_FOREIGN'),
        warehouseId: 'warehouse-2',
      },
    };
    const prisma = {
      storagePallet: { findUnique: vi.fn().mockResolvedValue(activePallet) },
      storagePalletBox: { findUnique: vi.fn().mockResolvedValue(foreignPlacement) },
      stockMovement: { findFirst: vi.fn() },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    await expect(
      service.restoreTsdPalletBox(activePallet.id, { boxCode: 'FFL_BOX_901' }, branchUser()),
    ).rejects.toThrow('Данные другого филиала недоступны');
    expect(prisma.stockMovement.findFirst).not.toHaveBeenCalled();
  });

  it('blocks TSD recovery of an unplaced box from another branch', async () => {
    const activePallet = { ...pallet('pallet-active', 'PALLET_ACTIVE'), status: 'OPEN' };
    const skuFindMany = vi.fn();
    const prisma = {
      storagePallet: { findUnique: vi.fn().mockResolvedValue(activePallet) },
      storagePalletBox: { findUnique: vi.fn().mockResolvedValue(null) },
      stockMovement: { findFirst: vi.fn().mockResolvedValue(null) },
      box: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'box-foreign',
          clientId: 'client-1',
          warehouseId: 'warehouse-2',
          code: 'FFL_BOX_904',
          status: 'archived',
          balances: [],
        }),
      },
      sku: { findMany: skuFindMany },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    await expect(
      service.restoreTsdPalletBox(
        activePallet.id,
        {
          boxCode: 'FFL_BOX_904',
          idempotencyKey: 'restore-foreign',
          items: [{ skuId: 'sku-1', barcode: '4600000000001', quantity: 1 }],
        },
        branchUser(),
      ),
    ).rejects.toThrow('другому филиалу');
    expect(skuFindMany).not.toHaveBeenCalled();
  });

  it('writes the pallet warehouse to a restored box, balance, movement and audit', async () => {
    const activePallet = {
      ...pallet('pallet-active', 'PALLET_ACTIVE'),
      status: 'OPEN',
      client: { id: 'client-1', code: 'CLIENT', name: 'Client' },
      zone: null,
      boxes: [],
    };
    const restoredBox = {
      id: 'box-restored',
      clientId: 'client-1',
      warehouseId: 'warehouse-1',
      code: 'FFL_BOX_903',
      status: 'active',
    };
    const boxCreate = vi.fn().mockResolvedValue(restoredBox);
    const balanceCreate = vi.fn().mockResolvedValue({});
    const movementCreate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const placementUpsert = vi.fn().mockResolvedValue({
      id: 'placement-restored',
      palletId: activePallet.id,
      boxId: restoredBox.id,
      boxCode: restoredBox.code,
      source: 'TSD',
      box: { id: restoredBox.id, status: restoredBox.status },
      pallet: activePallet,
    });
    const boxFindUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(restoredBox);
    const prisma = {
      storagePallet: {
        findUnique: vi.fn().mockResolvedValue(activePallet),
        update: vi.fn().mockResolvedValue(activePallet),
      },
      storagePalletBox: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: placementUpsert,
      },
      stockMovement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: movementCreate,
      },
      box: { findUnique: boxFindUnique, create: boxCreate },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sku-1',
            clientId: 'client-1',
            internalSku: 'SKU-1',
            barcodes: [{ value: '4600000000001' }],
          },
        ]),
      },
      stockBalance: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: balanceCreate,
      },
      auditLog: { create: auditCreate },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    const balanceService = balances();
    const service = new StorageLocationsService(
      prisma as never,
      boxCodePolicy() as never,
      balanceService as never,
    );

    await service.restoreTsdPalletBox(
      activePallet.id,
      {
        boxCode: restoredBox.code,
        idempotencyKey: 'restore-warehouse-1',
        items: [{ skuId: 'sku-1', barcode: '4600000000001', quantity: 2 }],
      },
      branchUser(),
    );

    expect(boxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ warehouseId: 'warehouse-1' }),
    });
    expect(balanceService.balanceKey).toHaveBeenCalledWith(
      expect.objectContaining({ warehouseId: 'warehouse-1' }),
    );
    expect(balanceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ warehouseId: 'warehouse-1' }),
    });
    expect(movementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ warehouseId: 'warehouse-1' }),
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({ warehouseId: 'warehouse-1' }),
      }),
    });
  });

  it('limits the current TSD pallet query to the active writable branch and client scope', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { storagePallet: { findFirst } };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    await service.getCurrentTsdPallet('TSD-01', branchUser());

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deviceCode: 'TSD-01',
          status: 'OPEN',
          warehouseId: 'warehouse-1',
          clientId: { in: ['client-1'] },
        },
      }),
    );
  });

  it('preserves system administrator access across warehouses and clients', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      warehouse: {
        findUnique: vi.fn().mockResolvedValue({ id: 'warehouse-2', code: 'SPB', name: 'Другой филиал' }),
      },
      storagePallet: { findMany },
      zone: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    await service.listLayout('warehouse-2', undefined, false, adminUser());

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { warehouseId: 'warehouse-2' } }),
    );
  });

  // TEST: Google must not restore stale boxes after workers actualize a pallet through TSD.
  it('does not import Google boxes into a TSD-owned pallet', async () => {
    const placementUpsert = vi.fn();
    const prisma = {
      box: { findMany: vi.fn().mockResolvedValue([]) },
      storagePalletBox: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: placementUpsert,
      },
      storagePallet: {
        findUnique: vi.fn().mockResolvedValue({
          clientId: 'client-1',
          client: { name: 'Клиент' },
          _count: { boxes: 15 },
        }),
        upsert: vi.fn().mockResolvedValue({
          ...pallet('pallet-tsd', 'PALET_SORT_010'),
          source: 'TSD',
        }),
      },
      $transaction: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('PALET_SORT_010\nFFL_GOOGLE_001\nFFL_GOOGLE_002'),
    }));
    const service = new StorageLocationsService(prisma as never, boxCodePolicy() as never, balances() as never);

    try {
      await (service as any).performGoogleSync('warehouse-1', 'client-1');
    } finally {
      vi.unstubAllGlobals();
    }

    expect(prisma.storagePallet.upsert).toHaveBeenCalledOnce();
    expect(placementUpsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
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

function adminUser(id = 'admin-1') {
  return {
    id,
    email: `${id}@example.test`,
    name: 'Администратор',
    roleCodes: ['ADMIN'],
    permissionCodes: ['system:admin'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
    warehouseIds: [],
    writableWarehouseIds: [],
  } as never;
}

function branchUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'manager-1',
    email: 'manager@example.test',
    name: 'Менеджер филиала',
    roleCodes: ['BRANCH_MANAGER'],
    permissionCodes: ['warehouse:read', 'warehouse:write', 'stock:write'],
    clientScopeMode: 'LIMITED',
    clientIds: ['client-1'],
    writableClientIds: ['client-1'],
    activeWarehouseId: 'warehouse-1',
    warehouseIds: ['warehouse-1'],
    writableWarehouseIds: ['warehouse-1'],
    ...overrides,
  } as never;
}

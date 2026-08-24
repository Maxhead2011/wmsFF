import { StockStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ArchivedEmptyBoxPalletDetachService } from '../src/common/boxes/archived-empty-box-pallet-detach.service';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

describe('StockOperationsService: объединение коробов', () => {
  it('переносит весь остаток и КИЗ, затем архивирует пустой исходный короб', async () => {
    const sourceBalance = {
      id: 'balance-1',
      warehouseId: 'warehouse-1',
      balanceKey: 'source-key',
      clientId: 'client-1',
      skuId: 'sku-1',
      boxId: 'box-source',
      palletId: null,
      status: StockStatus.AVAILABLE,
      quantity: 3,
    };
    const tx = {
      stockMovement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn()
          .mockResolvedValueOnce({ id: 'move-out' })
          .mockResolvedValueOnce({ id: 'move-in' }),
      },
      box: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            id: 'box-source',
            clientId: 'client-1',
            code: 'FFL_SOURCE',
            status: 'active',
            warehouseId: 'warehouse-1',
            palletId: null,
            balances: [sourceBalance],
            productMarks: [{ id: 'mark-1', skuId: 'sku-1', status: StockStatus.AVAILABLE }],
          })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'box-source',
            clientId: 'client-1',
            code: 'FFL_SOURCE',
            status: 'archived',
            warehouseId: 'warehouse-1',
            storagePlacement: {
              id: 'placement-source',
              palletId: 'storage-pallet-1',
              boxCode: 'FFL_SOURCE',
            },
          }),
        create: vi.fn().mockResolvedValue({
          id: 'box-target',
          clientId: 'client-1',
          code: 'FFL_TARGET',
          status: 'active',
          warehouseId: 'warehouse-1',
          palletId: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      stockBalance: {
        update: vi.fn().mockResolvedValue({ ...sourceBalance, quantity: 0 }),
        delete: vi.fn().mockResolvedValue({}),
        upsert: vi.fn().mockResolvedValue({ id: 'target-balance', quantity: 3 }),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { quantity: null } }),
      },
      productMark: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      storagePalletBox: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'detach-audit-1' }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const inventoryLock = { assertStockMovementsAllowed: vi.fn() };
    const service = new StockOperationsService(
      prisma as never,
      clientScopes as never,
      { balanceKey: vi.fn().mockReturnValue('target-key') } as never,
      undefined,
      undefined,
      inventoryLock as never,
      undefined,
      undefined,
      new ArchivedEmptyBoxPalletDetachService(prisma as never),
    );

    const result = await service.transferWholeBox(
      {
        clientId: 'client-1',
        fromBoxCode: 'FFL_SOURCE',
        toBoxCode: 'FFL_TARGET',
        idempotencyKey: 'whole-box-1',
      },
      {
        id: 'worker-1',
        email: 'worker@example.test',
        name: 'Сотрудник',
        roleCodes: ['WAREHOUSE'],
        permissionCodes: ['stock:read', 'stock:write'],
        clientScopeMode: 'ALL',
        clientIds: [],
        writableClientIds: [],
        activeWarehouseId: 'warehouse-1',
        warehouseIds: ['warehouse-1'],
        writableWarehouseIds: ['warehouse-1'],
      },
    );

    expect(inventoryLock.assertStockMovementsAllowed).toHaveBeenCalledOnce();
    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'worker-1' }),
      'client-1',
      'write',
    );
    expect(result).toMatchObject({
      status: 'APPLIED',
      fromBox: 'FFL_SOURCE',
      toBox: 'FFL_TARGET',
      targetCreated: true,
      lines: 1,
      quantity: 3,
      movedMarks: 1,
      sourceArchived: true,
    });
    expect(tx.productMark.updateMany).toHaveBeenCalledWith({
      where: { boxId: 'box-source', skuId: 'sku-1', status: StockStatus.AVAILABLE },
      data: { boxId: 'box-target', stockMovementId: 'move-in' },
    });
    expect(tx.box.update).toHaveBeenCalledWith({
      where: { id: 'box-source' },
      data: { status: 'archived' },
    });
    // TEST: whole-box transfer must use the common archived-empty rule and remove only the stale placement.
    expect(tx.storagePalletBox.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'placement-source',
        boxId: 'box-source',
        box: {
          status: 'archived',
          balances: { none: { quantity: { gt: 0 } } },
        },
      },
    });
    // TEST: the caller transaction closes the balance-check/delete race.
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'EMPTY_ARCHIVED_BOX_AUTO_DETACHED',
        entityId: 'box-source',
        payload: expect.objectContaining({
          message: 'Пустой архивный короб автоматически удалён с паллетсорта',
          palletId: 'storage-pallet-1',
        }),
      }),
    });
  });

  it('under an administrator automatically moves orphan KIZ and records the bypass in the audit log', async () => {
    const sourceBalance = {
      id: 'balance-1',
      warehouseId: 'warehouse-1',
      balanceKey: 'source-key',
      clientId: 'client-1',
      skuId: 'sku-1',
      boxId: 'box-source',
      palletId: null,
      status: StockStatus.AVAILABLE,
      quantity: 1,
    };
    const tx = {
      stockMovement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn()
          .mockResolvedValueOnce({ id: 'move-out' })
          .mockResolvedValueOnce({ id: 'move-in' }),
      },
      box: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            id: 'box-source',
            clientId: 'client-1',
            code: 'FFL_SOURCE',
            status: 'active',
            palletId: null,
            warehouseId: 'warehouse-1',
            balances: [sourceBalance],
            productMarks: [
              { id: 'mark-1', skuId: 'sku-1', status: StockStatus.AVAILABLE },
              { id: 'orphan-mark-1', skuId: 'sku-2', status: StockStatus.AVAILABLE },
            ],
          })
          .mockResolvedValueOnce(null),
        create: vi.fn().mockResolvedValue({
          id: 'box-target',
          clientId: 'client-1',
          code: 'FFL_TARGET',
          status: 'active',
          warehouseId: 'warehouse-1',
          palletId: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      stockBalance: {
        update: vi.fn().mockResolvedValue({ ...sourceBalance, quantity: 0 }),
        delete: vi.fn().mockResolvedValue({}),
        upsert: vi.fn().mockResolvedValue({ id: 'target-balance', quantity: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      productMark: {
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new StockOperationsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
      { balanceKey: vi.fn().mockReturnValue('target-key') } as never,
      undefined,
      undefined,
      { assertStockMovementsAllowed: vi.fn() } as never,
    );

    const result = await service.transferWholeBox(
      {
        clientId: 'client-1',
        fromBoxCode: 'FFL_SOURCE',
        toBoxCode: 'FFL_TARGET',
        idempotencyKey: 'whole-box-admin-1',
      },
      {
        id: 'admin-1',
        email: 'admin@example.test',
        name: 'Администратор',
        roleCodes: ['ADMIN'],
        permissionCodes: ['stock:read', 'stock:write', 'system:admin'],
        clientScopeMode: 'ALL',
        clientIds: [],
        writableClientIds: [],
      },
    );

    expect(result).toMatchObject({
      status: 'APPLIED',
      quantity: 1,
      movedMarks: 2,
      autoApprovedChecks: 1,
      sourceArchived: true,
    });
    expect(tx.productMark.updateMany).toHaveBeenLastCalledWith({
      where: { id: { in: ['orphan-mark-1'] }, boxId: 'box-source' },
      data: { boxId: 'box-target', stockMovementId: null },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'ADMIN_AUTO_APPROVE_BOX_TRANSFER_CHECK',
        userId: 'admin-1',
      }),
    }));
  });
});

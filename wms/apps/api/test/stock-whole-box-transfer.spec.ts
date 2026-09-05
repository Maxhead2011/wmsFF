import { StockStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

describe('StockOperationsService: объединение коробов', () => {
  it('переносит весь остаток и КИЗ, затем архивирует пустой исходный короб', async () => {
    const sourceBalance = {
      id: 'balance-1',
      balanceKey: 'source-key',
      clientId: 'client-1',
      warehouseId: 'warehouse-1',
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
            warehouseId: 'warehouse-1',
            code: 'FFL_SOURCE',
            status: 'active',
            palletId: null,
            balances: [sourceBalance],
            productMarks: [{ id: 'mark-1', skuId: 'sku-1', status: StockStatus.AVAILABLE }],
          })
          .mockResolvedValueOnce(null),
        create: vi.fn().mockResolvedValue({
          id: 'box-target',
          clientId: 'client-1',
          warehouseId: 'warehouse-1',
          code: 'FFL_TARGET',
          status: 'active',
          palletId: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      stockBalance: {
        update: vi.fn().mockResolvedValue({ ...sourceBalance, quantity: 0 }),
        delete: vi.fn().mockResolvedValue({}),
        upsert: vi.fn().mockResolvedValue({ id: 'target-balance', quantity: 3 }),
        count: vi.fn().mockResolvedValue(0),
      },
      productMark: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
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
        // TEST: the source, destination and operator belong to the same writable branch.
        clientScopeMode: 'LIMITED',
        clientIds: ['client-1'],
        writableClientIds: ['client-1'],
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
  });
});

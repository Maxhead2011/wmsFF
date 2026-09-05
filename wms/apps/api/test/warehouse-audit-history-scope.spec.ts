import { NotFoundException } from '@nestjs/common';
import {
  ClientRequestStatus,
  StockStatus,
  WarehouseBoxCheckDecision,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { captureShippedKizHistory } from '../src/common/shipment-history/shipped-kiz-history';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { WarehouseBoxIntegrityService } from '../src/modules/warehouse/warehouse-box-integrity.service';
import { WarehouseShipmentHistoryService } from '../src/modules/warehouse/warehouse-shipment-history.service';

function branchUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-branch',
    email: 'branch@example.test',
    name: 'Branch manager',
    roleCodes: ['BRANCH_MANAGER'],
    permissionCodes: ['warehouse:read', 'warehouse:write'],
    clientScopeMode: 'LIMITED',
    clientIds: ['client-1'],
    writableClientIds: ['client-1'],
    activeWarehouseId: 'warehouse-msk',
    warehouseIds: ['warehouse-msk'],
    writableWarehouseIds: ['warehouse-msk'],
    ...overrides,
  };
}

function clientScopes() {
  return {
    resolveClientFilter: vi.fn(() => 'client-1'),
    requireClientAccess: vi.fn(),
  };
}

describe('warehouse audit history scope', () => {
  it('limits box-check list and included rows to the active readable warehouse', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new WarehouseBoxIntegrityService(
      { warehouseBoxCheck: { findMany } } as never,
      clientScopes() as never,
      {} as never,
      {} as never,
    );

    await service.listChecks(branchUser());

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ warehouseId: 'warehouse-msk' }),
        include: {
          rows: expect.objectContaining({
            where: expect.objectContaining({ warehouseId: 'warehouse-msk' }),
          }),
        },
      }),
    );
  });

  it('writes the active warehouse onto a new box-integrity check', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'check-1', rows: [] });
    const service = new WarehouseBoxIntegrityService(
      {
        box: { count: vi.fn().mockResolvedValue(0) },
        stockBalance: { findMany: vi.fn().mockResolvedValue([]) },
        warehouseBoxCheck: { create },
      } as never,
      clientScopes() as never,
      {} as never,
      {} as never,
    );

    await service.runCheck(
      { periodFrom: '2026-08-01', periodTo: '2026-08-14', clientId: 'client-1' },
      branchUser(),
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ warehouseId: 'warehouse-msk' }),
      }),
    );
  });

  it('rejects a decision for a check row from another warehouse', async () => {
    const boxFindUnique = vi.fn();
    const service = new WarehouseBoxIntegrityService(
      {
        warehouseBoxCheckRow: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'row-foreign',
            checkId: 'check-foreign',
            clientId: 'client-1',
            warehouseId: 'warehouse-krd',
            boxId: 'box-foreign',
            skuId: 'sku-1',
            decision: WarehouseBoxCheckDecision.PENDING,
          }),
        },
        box: { findUnique: boxFindUnique },
      } as never,
      clientScopes() as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.decideRow(
        'row-foreign',
        { action: WarehouseBoxCheckDecision.KEEP_AS_IS },
        branchUser(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(boxFindUnique).not.toHaveBeenCalled();
  });

  it('keeps balance identity and adjustment movement in the row warehouse', async () => {
    const balanceCreate = vi.fn().mockResolvedValue({ id: 'balance-new' });
    const movementCreate = vi.fn().mockResolvedValue({ id: 'movement-new' });
    const rowUpdate = vi.fn().mockResolvedValue({});
    const tx = {
      warehouseBoxCheckRow: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'row-1',
          warehouseId: 'warehouse-msk',
          decision: WarehouseBoxCheckDecision.PENDING,
        }),
        update: rowUpdate,
      },
      box: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'box-1',
          code: 'BOX-1',
          palletId: 'pallet-1',
          warehouseId: 'warehouse-msk',
        }),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([]),
        create: balanceCreate,
        count: vi.fn().mockResolvedValue(1),
      },
      stockMovement: { create: movementCreate },
      productMark: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const balanceKey = vi.fn().mockReturnValue('balance-key');
    const prisma = {
      warehouseBoxCheckRow: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'row-1',
          checkId: 'check-1',
          clientId: 'client-1',
          warehouseId: 'warehouse-msk',
          boxId: 'box-1',
          skuId: 'sku-1',
          decision: WarehouseBoxCheckDecision.PENDING,
        }),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue({ id: 'box-1', warehouseId: 'warehouse-msk' }),
      },
      warehouseBoxCheck: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'check-1',
          clientId: 'client-1',
          rows: [{ id: 'row-1' }],
        }),
      },
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const scopes = clientScopes();
    const service = new WarehouseBoxIntegrityService(
      prisma as never,
      scopes as never,
      { balanceKey } as never,
      { assertStockMovementsAllowed: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await service.decideRow(
      'row-1',
      { action: WarehouseBoxCheckDecision.SET_QUANTITY, quantity: 2 },
      branchUser(),
    );

    expect(balanceKey).toHaveBeenCalledWith(
      expect.objectContaining({ warehouseId: 'warehouse-msk', boxId: 'box-1' }),
    );
    expect(balanceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        warehouseId: 'warehouse-msk',
        boxId: 'box-1',
        quantity: 2,
      }),
    });
    expect(movementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        warehouseId: 'warehouse-msk',
        boxId: 'box-1',
        quantity: 2,
      }),
    });
    expect(rowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ warehouseId: 'warehouse-msk' }),
      }),
    );
  });

  // TEST: box-check write-off archives first and delegates placement removal to the shared rule.
  it('uses the shared archived-empty rule after writing off the last box unit', async () => {
    const detachIfArchivedAndEmpty = vi.fn().mockResolvedValue({ detached: true });
    const directPlacementDelete = vi.fn();
    const tx = {
      warehouseBoxCheckRow: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'row-empty',
          warehouseId: 'warehouse-msk',
          decision: WarehouseBoxCheckDecision.PENDING,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'box-empty',
          code: 'FFL_EMPTY',
          palletId: 'pallet-1',
          warehouseId: 'warehouse-msk',
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([{ id: 'balance-1', quantity: 1 }]),
        delete: vi.fn().mockResolvedValue({}),
        update: vi.fn(),
        create: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      stockMovement: { create: vi.fn().mockResolvedValue({ id: 'movement-1' }) },
      productMark: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
      storagePalletBox: { deleteMany: directPlacementDelete },
    };
    const prisma = {
      warehouseBoxCheckRow: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'row-empty',
          checkId: 'check-1',
          clientId: 'client-1',
          warehouseId: 'warehouse-msk',
          boxId: 'box-empty',
          skuId: 'sku-1',
          decision: WarehouseBoxCheckDecision.PENDING,
        }),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue({ id: 'box-empty', warehouseId: 'warehouse-msk' }),
      },
      warehouseBoxCheck: {
        findFirst: vi.fn().mockResolvedValue({ id: 'check-1', clientId: 'client-1', rows: [] }),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new WarehouseBoxIntegrityService(
      prisma as never,
      clientScopes() as never,
      {} as never,
      { assertStockMovementsAllowed: vi.fn().mockResolvedValue(undefined) } as never,
      { detachIfArchivedAndEmpty } as never,
    );

    await service.decideRow(
      'row-empty',
      { action: WarehouseBoxCheckDecision.WRITE_OFF },
      branchUser(),
    );

    expect(tx.box.update).toHaveBeenCalledWith({
      where: { id: 'box-empty' },
      data: { status: 'archived', palletId: null, zoneId: null },
    });
    expect(directPlacementDelete).not.toHaveBeenCalled();
    expect(detachIfArchivedAndEmpty).toHaveBeenCalledWith(
      {
        boxId: 'box-empty',
        userId: 'user-branch',
        // TEST: reason is audit metadata; box, actor and transaction remain exact.
        reason: 'warehouse-box-integrity',
      },
      tx,
    );
  });

  it('limits shipment-history list and sync to the active warehouse', async () => {
    const historyFindMany = vi.fn().mockResolvedValue([]);
    const requestFindMany = vi.fn().mockResolvedValue([]);
    const service = new WarehouseShipmentHistoryService(
      {
        shippedKizHistory: { findMany: historyFindMany },
        clientRequest: { findMany: requestFindMany },
      } as never,
      clientScopes() as never,
    );

    await service.list({}, branchUser());
    await service.sync(branchUser());

    expect(historyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ warehouseId: 'warehouse-msk' }),
      }),
    );
    expect(requestFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          warehouseId: 'warehouse-msk',
          status: ClientRequestStatus.DONE,
        }),
      }),
    );
  });

  it('derives legacy shipment scope from a single physical SHIP warehouse', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const movementFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ warehouseId: 'warehouse-msk' }])
      .mockResolvedValueOnce([]);
    const tx = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          number: 1,
          title: 'Request 1',
          status: ClientRequestStatus.DONE,
          clientId: 'client-1',
          warehouseId: null,
          client: { name: 'Client 1' },
          updatedAt: new Date('2026-08-14T10:00:00.000Z'),
        }),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'assembly-1',
            orderId: 'order-1',
            supplyId: 'supply-1',
            skuId: 'sku-1',
            kiz: 'KIZ-1',
            boxId: 'box-1',
            boxCode: 'BOX-1',
            completedAt: new Date('2026-08-14T09:00:00.000Z'),
          },
        ]),
      },
      stockMovement: { findMany: movementFindMany },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sku-1',
            internalSku: 'SKU-1',
            article: 'ART-1',
            name: 'Product 1',
            color: 'Blue',
            size: 'M',
            barcodes: [{ value: '460000000001', isPrimary: true }],
          },
        ]),
      },
      productMark: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      shippedKizHistory: { createMany },
    };

    await expect(
      captureShippedKizHistory(tx as never, 'request-1'),
    ).resolves.toBe(1);

    expect(movementFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          sourceDocument: 'request-1',
          warehouseId: { not: null },
        }),
      }),
    );
    expect(movementFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ warehouseId: 'warehouse-msk' }),
      }),
    );
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ warehouseId: 'warehouse-msk', kiz: 'KIZ-1' })],
      skipDuplicates: true,
    });
  });

  it('leaves ambiguous legacy shipments unscoped instead of leaking them to a branch', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-ambiguous',
          number: 2,
          title: 'Ambiguous request',
          status: ClientRequestStatus.DONE,
          clientId: 'client-1',
          warehouseId: null,
          client: { name: 'Client 1' },
          updatedAt: new Date('2026-08-14T10:00:00.000Z'),
        }),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'assembly-2',
            orderId: 'order-2',
            supplyId: null,
            skuId: 'sku-1',
            kiz: 'KIZ-2',
            boxId: null,
            boxCode: null,
            completedAt: new Date('2026-08-14T09:00:00.000Z'),
          },
        ]),
      },
      stockMovement: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            { warehouseId: 'warehouse-msk' },
            { warehouseId: 'warehouse-krd' },
          ])
          .mockResolvedValueOnce([]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sku-1',
            internalSku: 'SKU-1',
            article: null,
            name: 'Product 1',
            color: null,
            size: null,
            barcodes: [],
          },
        ]),
      },
      productMark: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      shippedKizHistory: { createMany },
    };

    await captureShippedKizHistory(tx as never, 'request-ambiguous');

    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ warehouseId: null, kiz: 'KIZ-2' })],
      skipDuplicates: true,
    });
  });
});

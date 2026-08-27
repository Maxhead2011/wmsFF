import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { StockStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS_KEY } from '../src/modules/auth/decorators/require-permissions.decorator';
import { AdministrationController } from '../src/modules/administration/administration.controller';
import {
  ADMIN_UNPALLETED_WRITEOFF_SOURCE,
  AdministrationUnpalletedWriteoffService,
  UNPALLETED_BLOCKER_RECHECK_CONFIRMATION,
  UNPALLETED_WRITEOFF_CONFIRMATION,
  UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
} from '../src/modules/administration/administration-unpalleted-writeoff.service';

const admin = {
  id: 'admin-1',
  name: 'Администратор',
  permissionCodes: ['system:admin'],
  roleCodes: ['ADMIN'],
  clientScopeMode: 'ALL',
  clientIds: [],
  writableClientIds: [],
} as const;

const targetClient = {
  id: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
  code: 'CL-000001',
  name: 'ИП Лукин Илья Ильич',
  stockBalanceMode: 'PALLET_SORT',
  storesWithoutBoxes: false,
};

function balance(
  id: string,
  boxId: string,
  status: StockStatus = StockStatus.AVAILABLE,
  quantity = 2,
) {
  return {
    id,
    clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
    warehouseId: 'warehouse-1',
    skuId: `sku-${id}`,
    boxId,
    palletId: null,
    status,
    quantity,
    updatedAt: new Date('2026-08-27T10:00:00.000Z'),
    sku: {
      clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
      needsChestnyZnak: false,
      isUnmarked: false,
    },
  };
}

function box(id: string, code: string, balances: ReturnType<typeof balance>[]) {
  return {
    id,
    code,
    clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
    warehouseId: 'warehouse-1',
    status: 'active',
    balances,
  };
}

// TEST: the preview is read-only and treats a code-only pallet link case-insensitively.
describe('AdministrationUnpalletedWriteoffService', () => {
  // TEST: all three HTTP endpoints require system:admin before the service is reached.
  it('защищает preview, recheck и apply декоратором system:admin', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        AdministrationController.prototype.previewUnpalletedBoxWriteoff,
      ),
    ).toEqual(['system:admin']);
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        AdministrationController.prototype.recheckUnpalletedBoxBlockers,
      ),
    ).toEqual(['system:admin']);
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        AdministrationController.prototype.applyUnpalletedBoxWriteoff,
      ),
    ).toEqual(['system:admin']);
  });

  it('показывает только реально непривязанные короба и разделяет безопасные и заблокированные', async () => {
    const safeBox = box('box-safe', 'FFL_LKB_SAFE', [balance('bal-safe', 'box-safe')]);
    const placedByCode = box('box-placed', 'FFL_LKB_PLACED', [balance('bal-placed', 'box-placed')]);
    const packingBox = box('box-packing', 'FFL_LKB_PACKING', [
      balance('bal-packing', 'box-packing', StockStatus.PACKING, 1),
    ]);
    const requestedBox = box('box-request', 'FFL_LKB_REQUEST', [balance('bal-request', 'box-request')]);
    const assemblyBox = box('box-assembly', 'FFL_LKB_ASSEMBLY', [
      balance('bal-assembly', 'box-assembly'),
    ]);
    const inventoryBox = box('box-inventory', 'FFL_LKB_INVENTORY', [
      balance('bal-inventory', 'box-inventory'),
    ]);
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue(targetClient) },
      box: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            safeBox,
            placedByCode,
            packingBox,
            requestedBox,
            assemblyBox,
            inventoryBox,
          ]),
      },
      storagePalletBox: {
        findMany: vi.fn().mockResolvedValue([
          { boxId: null, boxCode: 'ffl_lkb_placed' },
        ]),
      },
      clientRequestBoxSelection: {
        findMany: vi.fn().mockResolvedValue([
          {
            boxId: 'box-request',
            requestItem: { request: { id: 'request-1', number: 311, status: 'IN_WORK' } },
          },
        ]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'assembly-1',
            clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
            status: 'RESERVED',
            requestId: 'request-2',
            reservedBoxId: 'box-assembly',
            reservedBoxCode: 'FFL_LKB_ASSEMBLY',
            boxId: null,
            boxCode: null,
          },
        ]),
      },
      inventoryAuditBox: {
        findMany: vi.fn().mockResolvedValue([
          { boxId: 'box-inventory', sessionId: 'inventory-1' },
        ]),
      },
      productMark: { findMany: vi.fn().mockResolvedValue([]) },
      pickWaveBalanceLine: { findMany: vi.fn().mockResolvedValue([]) },
      warehouseBoxCheckRow: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(),
      stockBalance: { delete: vi.fn() },
      boxMutation: { update: vi.fn() },
    };
    const service = new AdministrationUnpalletedWriteoffService(
      prisma as never,
      { assertStockMovementsAllowed: vi.fn() } as never,
    );

    const result = await service.preview(admin as never);

    expect(prisma.box.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
          status: 'active',
          balances: { some: { quantity: { gt: 0 } } },
        }),
      }),
    );
    expect(result.summary).toMatchObject({ candidates: 5, safe: 1, blocked: 4, units: 9 });
    expect(result.rows.map((row) => row.boxId)).toEqual([
      'box-assembly',
      'box-inventory',
      'box-packing',
      'box-request',
      'box-safe',
    ]);
    expect(result.rows.find((row) => row.boxId === 'box-safe')).toMatchObject({ safe: true });
    expect(result.rows.find((row) => row.boxId === 'box-packing')?.blockers).toContain(
      'NON_AVAILABLE_BALANCE',
    );
    expect(result.rows.find((row) => row.boxId === 'box-request')?.blockers).toContain(
      'ACTIVE_CLIENT_REQUEST',
    );
    expect(result.rows.find((row) => row.boxId === 'box-assembly')?.blockers).toContain(
      'ACTIVE_FBS_ASSEMBLY',
    );
    expect(result.rows.find((row) => row.boxId === 'box-inventory')?.blockers).toContain(
      'OPEN_INVENTORY',
    );
    expect(prisma.clientRequestBoxSelection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requestItem: {
            request: { status: { notIn: ['DONE', 'CANCELLED', 'REJECTED'] } },
          },
        }),
      }),
    );
    expect(prisma.pickWaveBalanceLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          wave: { status: { notIn: ['DONE', 'CANCELLED'] } },
        }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.stockBalance.delete).not.toHaveBeenCalled();
  });

  // TEST: a KIZ count mismatch is visible but is not a blocker for the explicitly approved
  // cleanup; foreign data, active waves and pending checks remain hard blockers.
  it('показывает расхождение КИЗ как предупреждение и группирует реальные блокировки', async () => {
    const foreign = box('box-foreign', 'FFL_FOREIGN', [
      {
        ...balance('bal-foreign', 'box-foreign', StockStatus.AVAILABLE, 1),
        clientId: 'other-client',
        sku: { clientId: 'other-client', needsChestnyZnak: false, isUnmarked: false },
      },
    ]);
    const kizMismatchBalance = balance('bal-kiz', 'box-kiz', StockStatus.AVAILABLE, 1);
    kizMismatchBalance.sku.needsChestnyZnak = true;
    const boxes = [
      foreign,
      box('box-kiz', 'FFL_KIZ', [kizMismatchBalance]),
      box('box-wave', 'FFL_WAVE', [balance('bal-wave', 'box-wave')]),
      box('box-check', 'FFL_CHECK', [balance('bal-check', 'box-check')]),
    ];
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue(targetClient) },
      box: { findMany: vi.fn().mockResolvedValue(boxes) },
      storagePalletBox: { findMany: vi.fn().mockResolvedValue([]) },
      clientRequestBoxSelection: { findMany: vi.fn().mockResolvedValue([]) },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryAuditBox: { findMany: vi.fn().mockResolvedValue([]) },
      productMark: {
        findMany: vi.fn().mockResolvedValue([
          { boxId: 'box-kiz', clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID, skuId: 'sku-bal-kiz', status: StockStatus.AVAILABLE, sku: { clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID } },
          { boxId: 'box-kiz', clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID, skuId: 'sku-bal-kiz', status: StockStatus.AVAILABLE, sku: { clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID } },
        ]),
      },
      pickWaveBalanceLine: {
        findMany: vi.fn().mockResolvedValue([
          { balanceId: 'bal-wave', sourceBoxId: 'box-wave', sourceBoxCode: 'FFL_WAVE' },
        ]),
      },
      warehouseBoxCheckRow: {
        findMany: vi.fn().mockResolvedValue([
          { boxId: 'box-check', boxCode: 'FFL_CHECK' },
        ]),
      },
    };
    const service = new AdministrationUnpalletedWriteoffService(
      prisma as never,
      { assertStockMovementsAllowed: vi.fn() } as never,
    );

    const result = await service.preview(admin as never);

    expect(result.rows.find((row) => row.boxId === 'box-foreign')?.blockers).toContain('FOREIGN_CLIENT_DATA');
    expect(result.rows.find((row) => row.boxId === 'box-kiz')).toMatchObject({
      safe: true,
      blockers: [],
      warnings: ['KIZ_COUNT_MISMATCH'],
    });
    expect(result.rows.find((row) => row.boxId === 'box-wave')?.blockers).toContain('ACTIVE_PICK_WAVE');
    expect(result.rows.find((row) => row.boxId === 'box-check')?.blockers).toContain('PENDING_BOX_CHECK');
    expect(result.summary).toMatchObject({ safe: 1, blocked: 3, warnings: 1 });
    expect(result.blockerSummary).toEqual([
      { blocker: 'ACTIVE_PICK_WAVE', boxes: 1, units: 2 },
      { blocker: 'FOREIGN_CLIENT_DATA', boxes: 1, units: 1 },
      { blocker: 'PENDING_BOX_CHECK', boxes: 1, units: 2 },
    ]);
    expect(result.warningSummary).toEqual([
      { warning: 'KIZ_COUNT_MISMATCH', boxes: 1, units: 1 },
    ]);
  });

  // TEST: recheck must reuse authoritative WB synchronization and only ask InventoryService
  // to finish already resolved sessions; the administration service does not rewrite their rows.
  it('массово перепроверяет WB и завершённые инвентаризации штатными сервисами', async () => {
    const candidate = box('box-kiz', 'FFL_KIZ', [balance('bal-kiz', 'box-kiz')]);
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue(targetClient) },
      box: { findMany: vi.fn().mockResolvedValue([candidate]) },
      storagePalletBox: { findMany: vi.fn().mockResolvedValue([]) },
      clientRequestBoxSelection: { findMany: vi.fn().mockResolvedValue([]) },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryAuditBox: { findMany: vi.fn().mockResolvedValue([]) },
      productMark: { findMany: vi.fn().mockResolvedValue([]) },
      pickWaveBalanceLine: { findMany: vi.fn().mockResolvedValue([]) },
      warehouseBoxCheckRow: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-recheck' }) },
    };
    const marketplaceConnections = {
      listFbsOrders: vi.fn().mockResolvedValue({ orders: [] }),
    };
    const inventory = {
      completeResolvedSessionsForBoxes: vi.fn().mockResolvedValue({
        checked: 2,
        completed: 1,
        sessionIds: ['inventory-1'],
      }),
    };
    const service = new AdministrationUnpalletedWriteoffService(
      prisma as never,
      { assertStockMovementsAllowed: vi.fn() } as never,
      marketplaceConnections as never,
      inventory as never,
    );

    const result = await service.recheck(
      { confirmation: UNPALLETED_BLOCKER_RECHECK_CONFIRMATION },
      admin as never,
    );

    expect(marketplaceConnections.listFbsOrders).toHaveBeenCalledWith(
      UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
      admin,
      true,
    );
    expect(inventory.completeResolvedSessionsForBoxes).toHaveBeenCalledWith(
      ['box-kiz'],
      admin,
    );
    expect(result).toMatchObject({
      fbs: { refreshed: true, error: null },
      inventory: { checked: 2, completed: 1, sessionIds: ['inventory-1'] },
      preview: { summary: { candidates: 1 } },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: admin.id,
        action: 'administration.unpalleted-box.blockers_rechecked',
      }),
    });
  });

  // TEST: controller guards are not the only protection; the service also rejects a client user.
  it('запрещает анализ и списание без system:admin', async () => {
    const service = new AdministrationUnpalletedWriteoffService(
      {} as never,
      { assertStockMovementsAllowed: vi.fn() } as never,
    );
    const clientUser = { ...admin, permissionCodes: [], roleCodes: ['CLIENT'] };

    await expect(service.preview(clientUser as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.apply(
        { boxIds: ['box-safe'], confirmation: UNPALLETED_WRITEOFF_CONFIRMATION },
        clientUser as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const privilegedClient = { ...admin, roleCodes: ['CLIENT'] };
    await expect(service.preview(privilegedClient as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.apply(
        { boxIds: ['box-safe'], confirmation: UNPALLETED_WRITEOFF_CONFIRMATION },
        privilegedClient as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const demoAdmin = { ...admin, isDemo: true };
    await expect(service.preview(demoAdmin as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.apply(
        { boxIds: ['box-safe'], confirmation: UNPALLETED_WRITEOFF_CONFIRMATION },
        demoAdmin as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // TEST: a successful apply writes an exact negative ledger movement and archives the empty box.
  it('списывает AVAILABLE, блокирует только AVAILABLE КИЗы и архивирует короб атомарно', async () => {
    const sourceBalance = balance('bal-safe', 'box-safe', StockStatus.AVAILABLE, 2);
    sourceBalance.sku.needsChestnyZnak = true;
    const sourceBox = box('box-safe', 'FFL_LKB_SAFE', [sourceBalance]);
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      box: {
        findFirst: vi.fn().mockResolvedValue(sourceBox),
        update: vi.fn().mockResolvedValue({ ...sourceBox, status: 'archived' }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'box-safe' }]),
      inventorySession: { findFirst: vi.fn().mockResolvedValue(null) },
      storagePalletBox: { findFirst: vi.fn().mockResolvedValue(null) },
      clientRequestBoxSelection: { findFirst: vi.fn().mockResolvedValue(null) },
      fbsTsdAssembly: { findFirst: vi.fn().mockResolvedValue(null) },
      inventoryAuditBox: { findFirst: vi.fn().mockResolvedValue(null) },
      stockMovement: { create: vi.fn().mockResolvedValue({ id: 'movement-1' }) },
      productMark: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'mark-1', clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID, skuId: sourceBalance.skuId, status: StockStatus.AVAILABLE, sku: { clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID } },
          { id: 'mark-2', clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID, skuId: sourceBalance.skuId, status: StockStatus.AVAILABLE, sku: { clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID } },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      pickWaveBalanceLine: { findFirst: vi.fn().mockResolvedValue(null) },
      warehouseBoxCheckRow: { findFirst: vi.fn().mockResolvedValue(null) },
      stockBalance: { delete: vi.fn().mockResolvedValue(sourceBalance) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue(targetClient) },
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const inventoryLock = { assertStockMovementsAllowed: vi.fn().mockResolvedValue(undefined) };
    const service = new AdministrationUnpalletedWriteoffService(
      prisma as never,
      inventoryLock as never,
    );

    const result = await service.apply(
      { boxIds: ['box-safe'], confirmation: UNPALLETED_WRITEOFF_CONFIRMATION },
      admin as never,
    );

    expect(inventoryLock.assertStockMovementsAllowed).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      maxWait: 10_000,
      timeout: 10_000,
    });
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0],
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.box.findFirst.mock.invocationCallOrder[0],
    );
    expect(tx.box.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      tx.stockMovement.create.mock.invocationCallOrder[0],
    );
    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
        boxId: 'box-safe',
        skuId: sourceBalance.skuId,
        type: 'INVENTORY_ADJUSTMENT',
        status: StockStatus.AVAILABLE,
        quantity: -2,
        sourceDocument: ADMIN_UNPALLETED_WRITEOFF_SOURCE,
        idempotencyKey: `${ADMIN_UNPALLETED_WRITEOFF_SOURCE}:box-safe:bal-safe`,
      }),
    });
    expect(tx.productMark.updateMany).toHaveBeenCalledWith({
      where: {
        clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
        boxId: 'box-safe',
        skuId: sourceBalance.skuId,
        status: StockStatus.AVAILABLE,
      },
      data: expect.objectContaining({
        status: StockStatus.BLOCKED,
        boxId: null,
        stockMovementId: 'movement-1',
      }),
    });
    expect(tx.stockBalance.delete).toHaveBeenCalledWith({ where: { id: 'bal-safe' } });
    expect(tx.box.update).toHaveBeenCalledWith({
      where: { id: 'box-safe' },
      data: { status: 'archived', palletId: null, zoneId: null },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: admin.id,
        action: 'administration.unpalleted-box.writeoff',
        entity: 'Box',
        entityId: 'box-safe',
      }),
    });
    expect(result).toMatchObject({ archived: 1, skipped: 0, unitsWrittenOff: 2 });
  });

  // TEST: a mismatched AVAILABLE count is cleaned up, while the query explicitly excludes
  // historical SHIPPING marks and the audit records that the warning existed.
  it('списывает короб с расхождением КИЗ, не изменяя SHIPPING', async () => {
    const sourceBalance = balance('bal-kiz-mismatch', 'box-kiz-mismatch', StockStatus.AVAILABLE, 3);
    sourceBalance.sku.needsChestnyZnak = true;
    const sourceBox = box('box-kiz-mismatch', 'FFL_KIZ_MISMATCH', [sourceBalance]);
    const tx = safeApplyTx(sourceBox);
    tx.productMark.findMany.mockResolvedValue([
      {
        boxId: sourceBox.id,
        clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
        skuId: sourceBalance.skuId,
        status: StockStatus.AVAILABLE,
        sku: { clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID },
      },
      {
        boxId: sourceBox.id,
        clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
        skuId: sourceBalance.skuId,
        status: StockStatus.SHIPPING,
        sku: { clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID },
      },
    ]);
    tx.productMark.updateMany.mockResolvedValue({ count: 1 });
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue(targetClient) },
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AdministrationUnpalletedWriteoffService(
      prisma as never,
      { assertStockMovementsAllowed: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.apply(
      { boxIds: [sourceBox.id], confirmation: UNPALLETED_WRITEOFF_CONFIRMATION },
      admin as never,
    );

    expect(result.results[0]).toMatchObject({ outcome: 'ARCHIVED', unitsWrittenOff: 3, marksBlocked: 1 });
    expect(tx.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: StockStatus.AVAILABLE }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({ kizCountMismatch: true }),
      }),
    });
  });

  // TEST: the destructive endpoint is bounded and requires an exact confirmation phrase.
  it('требует точное подтверждение и не принимает больше 25 коробов', async () => {
    const prisma = { client: { findUnique: vi.fn().mockResolvedValue(targetClient) } };
    const service = new AdministrationUnpalletedWriteoffService(
      prisma as never,
      { assertStockMovementsAllowed: vi.fn() } as never,
    );

    await expect(
      service.apply({ boxIds: ['box-safe'], confirmation: 'ДА' }, admin as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.apply(
        {
          boxIds: Array.from({ length: 26 }, (_, index) => `box-${index}`),
          confirmation: UNPALLETED_WRITEOFF_CONFIRMATION,
        },
        admin as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.apply(
        {
          boxIds: [`box-${'x'.repeat(100)}`],
          confirmation: UNPALLETED_WRITEOFF_CONFIRMATION,
        },
        admin as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // TEST: exactly 25 valid IDs pass boundary validation and reach the safety lock.
  it('принимает граничную партию из 25 коробов', async () => {
    const stopAfterValidation = new Error('STOP_AFTER_VALIDATION');
    const inventoryLock = {
      assertStockMovementsAllowed: vi.fn().mockRejectedValue(stopAfterValidation),
    };
    const service = new AdministrationUnpalletedWriteoffService(
      { client: { findUnique: vi.fn().mockResolvedValue(targetClient) } } as never,
      inventoryLock as never,
    );

    await expect(
      service.apply(
        {
          boxIds: Array.from({ length: 25 }, (_, index) => `box-${index}`),
          confirmation: UNPALLETED_WRITEOFF_CONFIRMATION,
        },
        admin as never,
      ),
    ).rejects.toBe(stopAfterValidation);
    expect(inventoryLock.assertStockMovementsAllowed).toHaveBeenCalledOnce();
  });

  // TEST: a global stock-taking lock stops the operation before opening a transaction.
  it('не открывает транзакции и ничего не меняет при блокировке инвентаризацией', async () => {
    const inventoryError = new Error('FULL_INVENTORY_LOCK');
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue(targetClient) },
      $transaction: vi.fn(),
    };
    const inventoryLock = {
      assertStockMovementsAllowed: vi.fn().mockRejectedValue(inventoryError),
    };
    const service = new AdministrationUnpalletedWriteoffService(
      prisma as never,
      inventoryLock as never,
    );

    await expect(
      service.apply(
        { boxIds: ['box-safe'], confirmation: UNPALLETED_WRITEOFF_CONFIRMATION },
        admin as never,
      ),
    ).rejects.toBe(inventoryError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // TEST: placement created after preview wins the race and prevents every write.
  it('пропускает короб, если перед транзакцией он оказался на паллет-сорте', async () => {
    const sourceBox = box('box-raced', 'FFL_LKB_RACED', [balance('bal-raced', 'box-raced')]);
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      box: { findFirst: vi.fn().mockResolvedValue(sourceBox), update: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'box-raced' }]),
      inventorySession: { findFirst: vi.fn().mockResolvedValue(null) },
      storagePalletBox: {
        findFirst: vi.fn().mockResolvedValue({ id: 'placement-1', boxId: 'box-raced' }),
      },
      clientRequestBoxSelection: { findFirst: vi.fn() },
      fbsTsdAssembly: { findFirst: vi.fn() },
      inventoryAuditBox: { findFirst: vi.fn() },
      stockMovement: { create: vi.fn() },
      productMark: { updateMany: vi.fn() },
      stockBalance: { delete: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue(targetClient) },
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AdministrationUnpalletedWriteoffService(
      prisma as never,
      { assertStockMovementsAllowed: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.apply(
      { boxIds: ['box-raced'], confirmation: UNPALLETED_WRITEOFF_CONFIRMATION },
      admin as never,
    );

    expect(result).toMatchObject({ archived: 0, skipped: 1, unitsWrittenOff: 0 });
    expect(result.results[0]).toMatchObject({ boxId: 'box-raced', outcome: 'SKIPPED' });
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.stockBalance.delete).not.toHaveBeenCalled();
    expect(tx.box.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  // TEST: the locked recheck records a late KIZ mismatch but still performs the explicitly
  // approved cleanup; updateMany remains scoped to AVAILABLE marks.
  it('фиксирует позднее расхождение КИЗ и списывает только AVAILABLE', async () => {
    const sourceBalance = balance('bal-kiz-race', 'box-kiz-race', StockStatus.AVAILABLE, 1);
    sourceBalance.sku.needsChestnyZnak = true;
    const sourceBox = box('box-kiz-race', 'FFL_KIZ_RACE', [sourceBalance]);
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([{ id: sourceBox.id }]),
      inventorySession: { findFirst: vi.fn().mockResolvedValue(null) },
      box: { findFirst: vi.fn().mockResolvedValue(sourceBox), update: vi.fn().mockResolvedValue({}) },
      storagePalletBox: { findFirst: vi.fn().mockResolvedValue(null) },
      clientRequestBoxSelection: { findFirst: vi.fn().mockResolvedValue(null) },
      fbsTsdAssembly: { findFirst: vi.fn().mockResolvedValue(null) },
      inventoryAuditBox: { findFirst: vi.fn().mockResolvedValue(null) },
      productMark: {
        findMany: vi.fn().mockResolvedValue([
          { boxId: sourceBox.id, clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID, skuId: sourceBalance.skuId, status: StockStatus.AVAILABLE, sku: { clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID } },
          { boxId: sourceBox.id, clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID, skuId: sourceBalance.skuId, status: StockStatus.AVAILABLE, sku: { clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID } },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      pickWaveBalanceLine: { findFirst: vi.fn().mockResolvedValue(null) },
      warehouseBoxCheckRow: { findFirst: vi.fn().mockResolvedValue(null) },
      stockMovement: { create: vi.fn().mockResolvedValue({ id: 'movement-kiz-race' }) },
      stockBalance: { delete: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-kiz-race' }) },
    };
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue(targetClient) },
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AdministrationUnpalletedWriteoffService(
      prisma as never,
      { assertStockMovementsAllowed: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.apply(
      { boxIds: [sourceBox.id], confirmation: UNPALLETED_WRITEOFF_CONFIRMATION },
      admin as never,
    );

    expect(result.results[0]).toMatchObject({ outcome: 'ARCHIVED', reason: null, marksBlocked: 2 });
    expect(tx.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: StockStatus.AVAILABLE }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ payload: expect.objectContaining({ kizCountMismatch: true }) }),
    });
  });

  // TEST: an archived/already processed box makes retries idempotent.
  it('повторный запуск не создаёт второе движение', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      box: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'box-safe' }]),
      inventorySession: { findFirst: vi.fn().mockResolvedValue(null) },
      storagePalletBox: { findFirst: vi.fn() },
      stockMovement: { create: vi.fn() },
      stockBalance: { delete: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue(targetClient) },
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AdministrationUnpalletedWriteoffService(
      prisma as never,
      { assertStockMovementsAllowed: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.apply(
      { boxIds: ['box-safe'], confirmation: UNPALLETED_WRITEOFF_CONFIRMATION },
      admin as never,
    );

    expect(result).toMatchObject({ archived: 0, skipped: 1, unitsWrittenOff: 0 });
    expect(tx.box.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'box-safe',
          clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
          status: 'active',
        }),
      }),
    );
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.stockBalance.delete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  // TEST: every mutable dependency is rechecked after the Box row lock, not trusted from preview.
  it.each([
    ['NON_AVAILABLE_BALANCE', 'non-available'],
    ['ACTIVE_CLIENT_REQUEST', 'request'],
    ['ACTIVE_FBS_ASSEMBLY', 'assembly'],
    ['OPEN_INVENTORY', 'inventory'],
    ['FOREIGN_CLIENT_DATA', 'foreign-assembly'],
    ['FOREIGN_CLIENT_DATA', 'foreign-balance'],
    ['FOREIGN_CLIENT_DATA', 'foreign-mark'],
    ['ACTIVE_PICK_WAVE', 'wave'],
    ['PENDING_BOX_CHECK', 'check'],
  ] as const)('не списывает короб при транзакционном блокере %s', async (reason, blocker) => {
    const sourceBox = box(`box-${blocker}`, `FFL_${blocker.toUpperCase()}`, [
      balance(`bal-${blocker}`, `box-${blocker}`),
    ]);
    const tx = safeApplyTx(sourceBox);
    if (blocker === 'non-available') sourceBox.balances[0].status = StockStatus.PACKING;
    if (blocker === 'request') tx.clientRequestBoxSelection.findFirst.mockResolvedValue({ id: 'selection-1' });
    if (blocker === 'assembly') {
      tx.fbsTsdAssembly.findFirst.mockResolvedValue({
        id: 'assembly-1',
        clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
      });
    }
    if (blocker === 'inventory') tx.inventoryAuditBox.findFirst.mockResolvedValue({ id: 'audit-box-1' });
    if (blocker === 'foreign-assembly') {
      tx.fbsTsdAssembly.findFirst.mockResolvedValue({ id: 'assembly-foreign', clientId: 'other-client' });
    }
    if (blocker === 'foreign-balance') {
      sourceBox.balances[0].clientId = 'other-client';
      sourceBox.balances[0].sku.clientId = 'other-client';
    }
    if (blocker === 'foreign-mark') {
      tx.productMark.findMany.mockResolvedValue([{
        boxId: sourceBox.id,
        clientId: 'other-client',
        skuId: sourceBox.balances[0].skuId,
        status: StockStatus.AVAILABLE,
        sku: { clientId: 'other-client' },
      }]);
    }
    if (blocker === 'wave') tx.pickWaveBalanceLine.findFirst.mockResolvedValue({ id: 'wave-line-1' });
    if (blocker === 'check') tx.warehouseBoxCheckRow.findFirst.mockResolvedValue({ id: 'check-row-1' });
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue(targetClient) },
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AdministrationUnpalletedWriteoffService(
      prisma as never,
      { assertStockMovementsAllowed: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.apply(
      { boxIds: [sourceBox.id], confirmation: UNPALLETED_WRITEOFF_CONFIRMATION },
      admin as never,
    );

    expect(result.results[0]).toMatchObject({ outcome: 'SKIPPED', reason });
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.productMark.updateMany).not.toHaveBeenCalled();
    expect(tx.stockBalance.delete).not.toHaveBeenCalled();
    expect(tx.box.update).not.toHaveBeenCalled();
  });

  // TEST: a FULL inventory that starts after preview is protected by a table lock and an in-tx recheck.
  it('останавливает короб внутри транзакции при полной инвентаризации', async () => {
    const sourceBox = box('box-full-lock', 'FFL_FULL_LOCK', [balance('bal-full-lock', 'box-full-lock')]);
    const tx = safeApplyTx(sourceBox);
    tx.inventorySession.findFirst.mockResolvedValue({ id: 'inventory-full-1' });
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue(targetClient) },
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AdministrationUnpalletedWriteoffService(
      prisma as never,
      { assertStockMovementsAllowed: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.apply(
      { boxIds: [sourceBox.id], confirmation: UNPALLETED_WRITEOFF_CONFIRMATION },
      admin as never,
    );

    expect(result.results[0]).toMatchObject({ outcome: 'SKIPPED', reason: 'FULL_INVENTORY_LOCK' });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  // TEST: opening a FULL inventory between boxes stops the rest and exposes a stable operator reason.
  it('не открывает транзакцию следующего короба после включения полной инвентаризации', async () => {
    const fullInventoryError = new ConflictException({
      code: 'FULL_INVENTORY_LOCK',
      message: 'Полная инвентаризация активна.',
    });
    const inventoryLock = {
      assertStockMovementsAllowed: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(fullInventoryError),
    };
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue(targetClient) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-failure' }) },
      $transaction: vi.fn().mockResolvedValue({
        boxId: 'box-first',
        boxCode: 'FFL_FIRST',
        outcome: 'ARCHIVED',
        reason: null,
        unitsWrittenOff: 1,
        marksBlocked: 0,
        movementIds: ['movement-1'],
      }),
    };
    const service = new AdministrationUnpalletedWriteoffService(prisma as never, inventoryLock as never);

    const result = await service.apply(
      {
        boxIds: ['box-first', 'box-second'],
        confirmation: UNPALLETED_WRITEOFF_CONFIRMATION,
      },
      admin as never,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result.results[1]).toMatchObject({ outcome: 'ERROR', reason: 'FULL_INVENTORY_LOCK' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityId: 'box-second',
        payload: expect.objectContaining({ publicReason: 'FULL_INVENTORY_LOCK' }),
      }),
    });
  });

  // TEST: a database failure for one box must not roll back or suppress an already completed box.
  it('изолирует ошибку одного короба и возвращает результат успешного короба', async () => {
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue(targetClient) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-failed' }) },
      $transaction: vi
        .fn()
        .mockResolvedValueOnce({
          boxId: 'box-safe',
          boxCode: 'FFL_LKB_SAFE',
          outcome: 'ARCHIVED',
          reason: null,
          unitsWrittenOff: 2,
          marksBlocked: 0,
          movementIds: ['movement-1'],
        })
        .mockRejectedValueOnce(new Error('connection reset by peer')),
    };
    const service = new AdministrationUnpalletedWriteoffService(
      prisma as never,
      { assertStockMovementsAllowed: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.apply(
      {
        boxIds: ['box-safe', 'box-failed'],
        confirmation: UNPALLETED_WRITEOFF_CONFIRMATION,
      },
      admin as never,
    );

    expect(result).toMatchObject({
      processed: 2,
      archived: 1,
      skipped: 0,
      failed: 1,
      unitsWrittenOff: 2,
    });
    expect(result.results[1]).toEqual({
      boxId: 'box-failed',
      boxCode: null,
      outcome: 'ERROR',
      reason: 'TRANSACTION_FAILED',
      unitsWrittenOff: 0,
      marksBlocked: 0,
      movementIds: [],
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: admin.id,
        action: 'administration.unpalleted-box.writeoff_failed',
        entityId: 'box-failed',
        payload: expect.objectContaining({
          errorCode: 'Error',
          publicReason: 'TRANSACTION_FAILED',
        }),
      }),
    });
  });
});

function safeApplyTx(sourceBox: ReturnType<typeof box>) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([{ id: sourceBox.id }]),
    inventorySession: { findFirst: vi.fn().mockResolvedValue(null) },
    box: {
      findFirst: vi.fn().mockResolvedValue(sourceBox),
      update: vi.fn().mockResolvedValue({ ...sourceBox, status: 'archived' }),
    },
    storagePalletBox: { findFirst: vi.fn().mockResolvedValue(null) },
    clientRequestBoxSelection: { findFirst: vi.fn().mockResolvedValue(null) },
    fbsTsdAssembly: { findFirst: vi.fn().mockResolvedValue(null) },
    inventoryAuditBox: { findFirst: vi.fn().mockResolvedValue(null) },
    productMark: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    pickWaveBalanceLine: { findFirst: vi.fn().mockResolvedValue(null) },
    warehouseBoxCheckRow: { findFirst: vi.fn().mockResolvedValue(null) },
    stockMovement: { create: vi.fn().mockResolvedValue({ id: 'movement-1' }) },
    stockBalance: { delete: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
}

import {
  InventoryBoxStatus,
  InventoryLineDecision,
  InventorySessionStatus,
  InventorySessionType,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { InventoryResolutionAction } from '../src/modules/inventory/dto/inventory.dto';
import { InventoryService } from '../src/modules/inventory/inventory.service';

const manager: AuthUser = {
  id: 'manager-1',
  email: 'manager@example.test',
  name: 'Менеджер',
  roleCodes: ['MANAGER'],
  permissionCodes: ['stock:read', 'stock:write'],
  clientScopeMode: 'LIMITED',
  clientIds: ['client-1'],
  writableClientIds: ['client-1'],
};

const administrator: AuthUser = {
  ...manager,
  id: 'admin-1',
  email: 'admin@example.test',
  name: 'Администратор',
  roleCodes: ['ADMIN'],
  permissionCodes: ['stock:read', 'stock:write', 'system:admin'],
  clientScopeMode: 'ALL',
};

const branchManager: AuthUser = {
  ...manager,
  id: 'branch-manager-1',
  email: 'branch-manager@example.test',
  name: 'Менеджер филиала',
  roleCodes: ['BRANCH_MANAGER'],
  activeWarehouseId: 'warehouse-a',
  warehouseIds: ['warehouse-a'],
  writableWarehouseIds: ['warehouse-a'],
};

const warehouseKeeper: AuthUser = {
  ...branchManager,
  id: 'warehouse-keeper-1',
  email: 'warehouse-keeper@example.test',
  name: 'Кладовщик',
  roleCodes: ['WAREHOUSE_KEEPER'],
};

describe('InventoryService box checks', () => {
  it('lets a warehouse keeper manage inventory and approve a repeated box check', async () => {
    const prisma = {
      inventorySession: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      inventoryBoxRescanRequest: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new InventoryService(prisma as never, {} as never, {} as never);

    const result = await service.dashboard(warehouseKeeper);

    expect(result).toMatchObject({
      canManage: true,
      canApproveRescan: true,
    });
    expect(prisma.inventoryBoxRescanRequest.findMany).toHaveBeenCalledOnce();
  });

  it('opens a box when the scanner omitted separators from its code', async () => {
    const storedBox = {
      id: 'box-1',
      clientId: 'client-1',
      code: 'FFL_LKNOV1607_004',
      status: 'active',
      client: { id: 'client-1', name: 'Клиент' },
    };
    const createdAuditBox = {
      id: 'audit-box-1',
      boxCode: storedBox.code,
      status: InventoryBoxStatus.COUNTING,
      lines: [],
    };
    const prisma = {
      inventorySession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-1',
          title: 'Проверка коробов',
          clientId: 'client-1',
          status: InventorySessionStatus.ACTIVE,
        }),
      },
      box: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(storedBox),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ id: storedBox.id }]),
      inventoryAuditBox: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(createdAuditBox),
      },
      inventoryBoxRescanRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      stockBalance: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (action: (tx: unknown) => unknown) => action(prisma)),
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await expect(service.openBox('session-1', 'FFLLKNOV1607004', manager))
      .resolves.toEqual(createdAuditBox);

    expect(prisma.box.findUnique).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: storedBox.id },
    }));
  });

  it('sends a box check with mismatches to reconciliation instead of completing it', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'session-1', status: InventorySessionStatus.REVIEW });
    const prisma = {
      inventorySession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-1',
          type: InventorySessionType.BOX_CHECK,
          status: InventorySessionStatus.ACTIVE,
        }),
        update,
      },
      inventoryAuditBox: {
        count: vi.fn().mockImplementation(({ where }) => Promise.resolve(
          where.status && typeof where.status === 'object' && 'notIn' in where.status
            ? 0
            : where.status === InventoryBoxStatus.COUNTING ? 0 : 1,
        )),
      },
      inventoryAuditLine: { count: vi.fn().mockResolvedValue(2) },
    };
    const service = new InventoryService(prisma as never, {} as never, {} as never);

    await service.sendToReview('session-1', manager);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: InventorySessionStatus.REVIEW, completedAt: null }),
    }));
  });

  it('auto-completes a mandatory FBS box check in REVIEW once no differences remain', async () => {
    const mandatorySession = {
      id: 'mandatory-session-1',
      type: InventorySessionType.BOX_CHECK,
      status: InventorySessionStatus.REVIEW,
      warehouseId: null,
      comment: '[FBS_MANDATORY_BOX_CHECK] required after FBS',
    };
    const completedSession = { ...mandatorySession, status: InventorySessionStatus.COMPLETED, boxes: [] };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      inventorySession: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(mandatorySession)
          .mockResolvedValueOnce(mandatorySession)
          .mockResolvedValueOnce(completedSession),
        updateMany,
      },
      inventoryAuditBox: {
        count: vi.fn().mockImplementation(({ where }) => Promise.resolve(
          where.status && typeof where.status === 'object' && 'notIn' in where.status
            ? 0
            : where.status === InventoryBoxStatus.COUNTING ? 0 : 1,
        )),
      },
      inventoryAuditLine: { count: vi.fn().mockResolvedValue(0) },
    };
    const service = new InventoryService(prisma as never, {} as never, {} as never);

    await expect(service.sendToReview('mandatory-session-1', manager)).resolves.toEqual(completedSession);

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'mandatory-session-1',
        status: { in: [InventorySessionStatus.ACTIVE, InventorySessionStatus.REVIEW] },
      }),
      data: expect.objectContaining({
        status: InventorySessionStatus.COMPLETED,
        completedByUserId: 'manager-1',
      }),
    }));
  });

  it('keeps a mandatory FBS box check in REVIEW while a difference is pending', async () => {
    const mandatorySession = {
      id: 'mandatory-session-pending',
      type: InventorySessionType.BOX_CHECK,
      status: InventorySessionStatus.REVIEW,
      warehouseId: null,
      comment: '[FBS_MANDATORY_BOX_CHECK] required after FBS',
    };
    const updateMany = vi.fn();
    const prisma = {
      inventorySession: {
        findUnique: vi.fn().mockResolvedValue(mandatorySession),
        updateMany,
      },
      inventoryAuditBox: {
        count: vi.fn().mockImplementation(({ where }) => Promise.resolve(
          where.status && typeof where.status === 'object' && 'notIn' in where.status
            ? 0
            : where.status === InventoryBoxStatus.COUNTING ? 0 : 1,
        )),
      },
      inventoryAuditLine: { count: vi.fn().mockResolvedValue(1) },
    };
    const service = new InventoryService(prisma as never, {} as never, {} as never);

    await expect(service.sendToReview('mandatory-session-pending', manager))
      .rejects.toThrow('Добавлять подсчёты можно только в активную инвентаризацию.');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not complete a mandatory FBS session until every box is MATCHED or RESOLVED', async () => {
    const mandatorySession = {
      id: 'mandatory-session-unresolved-box',
      type: InventorySessionType.BOX_CHECK,
      status: InventorySessionStatus.REVIEW,
      warehouseId: null,
      comment: '[FBS_MANDATORY_BOX_CHECK] required after FBS',
    };
    const updateMany = vi.fn();
    const prisma = {
      inventorySession: {
        findUnique: vi.fn().mockResolvedValue(mandatorySession),
        updateMany,
      },
      inventoryAuditBox: {
        count: vi.fn().mockResolvedValue(1),
      },
      inventoryAuditLine: { count: vi.fn().mockResolvedValue(0) },
    };
    const service = new InventoryService(prisma as never, {} as never, {} as never);

    await expect(service.sendToReview('mandatory-session-unresolved-box', manager))
      .rejects.toThrow('Добавлять подсчёты можно только в активную инвентаризацию.');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('auto-completes a matched mandatory FBS session when its box count finishes', async () => {
    const auditBox = {
      id: 'mandatory-box-1',
      sessionId: 'mandatory-session-1',
      clientId: 'client-1',
      status: InventoryBoxStatus.COUNTING,
      session: {
        id: 'mandatory-session-1',
        type: InventorySessionType.BOX_CHECK,
        status: InventorySessionStatus.ACTIVE,
        warehouseId: null,
        comment: '[FBS_MANDATORY_BOX_CHECK] required after FBS',
      },
    };
    const line = {
      id: 'line-matched',
      countedQuantity: 1,
      expectedQuantity: 1,
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      inventoryAuditBox: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(auditBox)
          .mockResolvedValueOnce({ ...auditBox, status: InventoryBoxStatus.MATCHED }),
        update: vi.fn().mockResolvedValue({ ...auditBox, status: InventoryBoxStatus.MATCHED }),
        count: vi.fn().mockImplementation(({ where }) => Promise.resolve(
          where.status && typeof where.status === 'object' && 'notIn' in where.status
            ? 0
            : where.status === InventoryBoxStatus.COUNTING ? 0 : 1,
        )),
      },
      inventoryAuditLine: {
        findMany: vi.fn().mockResolvedValue([line]),
        update: vi.fn().mockResolvedValue(line),
        count: vi.fn().mockResolvedValue(0),
      },
      inventorySession: {
        findUnique: vi.fn().mockResolvedValue(auditBox.session),
        updateMany,
      },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await expect(service.finishBox('mandatory-box-1', manager)).resolves.toMatchObject({
      status: InventoryBoxStatus.MATCHED,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'mandatory-session-1' }),
      data: expect.objectContaining({ status: InventorySessionStatus.COMPLETED }),
    }));
  });

  it('deletes an empty box-check session when it is finished', async () => {
    const remove = vi.fn().mockResolvedValue({ id: 'session-empty', boxes: [] });
    const update = vi.fn();
    const prisma = {
      inventorySession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-empty',
          type: InventorySessionType.BOX_CHECK,
          status: InventorySessionStatus.ACTIVE,
        }),
        delete: remove,
        update,
      },
      inventoryAuditBox: { count: vi.fn().mockResolvedValue(0) },
    };
    const service = new InventoryService(prisma as never, {} as never, {} as never);

    await service.sendToReview('session-empty', manager);

    expect(remove).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-empty' },
    }));
    expect(update).not.toHaveBeenCalled();
  });

  it('allows a manager to resolve a mismatch from an already completed box check', async () => {
    const lineUpdate = vi.fn().mockResolvedValue({});
    const boxUpdate = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
    const prisma = {
      inventorySession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-1',
          type: InventorySessionType.BOX_CHECK,
          status: InventorySessionStatus.COMPLETED,
          comment: null,
        }),
      },
      inventoryAuditLine: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'line-1',
          auditBoxId: 'audit-box-1',
          difference: -1,
          auditBox: {
            clientId: 'client-1',
            session: {
              type: InventorySessionType.BOX_CHECK,
              status: InventorySessionStatus.COMPLETED,
            },
          },
        }),
        update: lineUpdate,
        count: vi.fn().mockResolvedValue(0),
      },
      inventoryAuditBox: {
        update: boxUpdate,
        findUnique: vi.fn().mockResolvedValue({ id: 'audit-box-1', lines: [] }),
      },
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await service.decideLine(
      'line-1',
      { action: InventoryResolutionAction.ACCEPT_AS_IS },
      manager,
    );

    expect(lineUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ decision: InventoryLineDecision.KEEP_SYSTEM }),
    }));
    expect(boxUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: InventoryBoxStatus.RESOLVED }),
    }));
  });

  // TEST: when inventory zeroes a box that was archived first, the shared lifecycle rule must run.
  it('checks pallet detachment after inventory removes the last unit from an archived box', async () => {
    const detachIfArchivedAndEmpty = vi.fn().mockResolvedValue({ detached: true });
    const tx = {
      stockBalance: {
        findFirst: vi.fn().mockResolvedValue({ id: 'balance-1', quantity: 1 }),
        delete: vi.fn().mockResolvedValue({}),
        update: vi.fn(),
        create: vi.fn(),
      },
      stockMovement: { create: vi.fn().mockResolvedValue({ id: 'movement-1' }) },
    };
    const prisma = {
      inventoryAuditLine: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'line-archived',
          auditBoxId: 'audit-box-archived',
          skuId: 'sku-1',
          countedQuantity: 0,
          auditBox: {
            boxId: 'box-archived',
            boxCode: 'FFL_ARCHIVED',
            clientId: 'client-1',
            session: {
              warehouseId: null,
              title: 'Актуализация архивного короба',
              type: InventorySessionType.BOX_CHECK,
              status: InventorySessionStatus.ACTIVE,
            },
          },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      inventoryAuditBox: {
        findUnique: vi.fn().mockResolvedValue({ id: 'audit-box-archived', lines: [] }),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'box-archived',
          status: 'archived',
          warehouseId: null,
          palletId: null,
        }),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new InventoryService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
      {} as never,
      { detachIfArchivedAndEmpty } as never,
    );
    vi.spyOn(service as any, 'refreshBoxResolution').mockResolvedValue(undefined);

    await service.decideLine(
      'line-archived',
      { action: InventoryResolutionAction.DELETE_FROM_BOX },
      administrator,
    );

    expect(detachIfArchivedAndEmpty).toHaveBeenCalledWith(
      {
        boxId: 'box-archived',
        userId: 'admin-1',
        reason: 'inventory-adjustment',
      },
      tx,
    );
    // TEST: inventory uses the same serializable boundary as the common lifecycle rule.
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
  });

  it('requests administrator approval before a completed box can be checked again', async () => {
    const createRescanRequest = vi.fn().mockResolvedValue({ id: 'rescan-1' });
    const prisma = {
      inventorySession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-1',
          title: 'Проверка коробов',
          clientId: 'client-1',
          status: InventorySessionStatus.ACTIVE,
        }),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'box-1',
          clientId: 'client-1',
          code: 'FFL_BOX_1',
          status: 'active',
          client: { id: 'client-1', name: 'Клиент' },
        }),
      },
      inventoryAuditBox: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'audit-box-1',
          status: InventoryBoxStatus.MATCHED,
          lines: [],
        }),
      },
      inventoryBoxRescanRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: createRescanRequest,
      },
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await expect(service.openBox('session-1', 'FFL_BOX_1', manager))
      .rejects.toThrow('Запрос на повторную проверку отправлен администратору.');
    expect(createRescanRequest).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        boxCode: 'FFL_BOX_1',
        sessionId: 'session-1',
        requestedByUserId: manager.id,
      }),
    }));
  });

  it('automatically reopens a completed box when an administrator checks it again', async () => {
    const createRescanRequest = vi.fn();
    const reopened = {
      id: 'audit-box-1',
      status: InventoryBoxStatus.COUNTING,
      lines: [],
    };
    const prisma = {
      inventorySession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-1',
          title: 'Проверка коробов',
          clientId: 'client-1',
          status: InventorySessionStatus.ACTIVE,
        }),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'box-1',
          clientId: 'client-1',
          code: 'FFL_BOX_1',
          status: 'active',
          client: { id: 'client-1', name: 'Клиент' },
        }),
      },
      stockBalance: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryAuditLine: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      inventoryAuditBox: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'audit-box-1',
          status: InventoryBoxStatus.MATCHED,
          lines: [],
        }),
        findFirst: vi.fn().mockResolvedValue({
          id: 'audit-box-1',
          status: InventoryBoxStatus.MATCHED,
        }),
        update: vi.fn().mockResolvedValue(reopened),
      },
      inventoryBoxRescanRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: createRescanRequest,
      },
      $transaction: vi.fn(async (action: (tx: unknown) => unknown) => action(prisma)),
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await expect(service.openBox('session-1', 'FFL_BOX_1', administrator)).resolves.toEqual(reopened);

    expect(createRescanRequest).not.toHaveBeenCalled();
    expect(prisma.inventoryAuditBox.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: InventoryBoxStatus.COUNTING,
        countedByUserId: administrator.id,
      }),
    }));
  });

  it('hides already actualized boxes from the TSD work list', () => {
    const service = new InventoryService({} as never, {} as never, {} as never);
    const session = {
      id: 'session-1',
      boxes: [
        {
          id: 'resolved-box',
          status: InventoryBoxStatus.RESOLVED,
          lines: [],
        },
        {
          id: 'mismatch-box',
          status: InventoryBoxStatus.MISMATCH,
          lines: [],
        },
      ],
    };

    const result = (service as any).decorateSession(session, undefined, true);

    expect(result.boxes.map((box: { id: string }) => box.id)).toEqual(['mismatch-box']);
    expect(result.progress.checkedBoxes).toBe(2);
  });

  it('resolves inventory items only by a registered product barcode', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = {
      inventoryAuditBox: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'audit-box-1',
          clientId: 'client-1',
          clientName: 'Клиент',
          status: InventoryBoxStatus.COUNTING,
          session: { status: InventorySessionStatus.ACTIVE },
        }),
      },
      sku: { findFirst },
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await expect(service.scanItem(
      'audit-box-1',
      { barcode: 'INTERNAL-SKU' },
      manager,
    )).rejects.toThrow('При инвентаризации сканируйте только ШК товара');

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        clientId: 'client-1',
        barcodes: { some: { value: 'INTERNAL-SKU' } },
      },
    }));
  });

  it('lists only sessions of the active branch for a branch manager', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { inventorySession: { findMany } };
    const scopes = { resolveClientFilter: vi.fn().mockReturnValue({ in: ['client-1'] }) };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await service.listSessions(undefined, branchManager);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ warehouseId: 'warehouse-a' }),
    }));
  });

  it('persists the active branch on a new branch inventory session', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'session-a', warehouseId: 'warehouse-a', boxes: [] });
    const prisma = { inventorySession: { create } };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await service.startSession(
      { type: InventorySessionType.PARTIAL, clientId: 'client-1' },
      branchManager,
    );

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ warehouseId: 'warehouse-a', clientId: 'client-1' }),
    }));
  });

  it('rejects a physical box from another branch before opening it', async () => {
    const prisma = {
      inventorySession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-a',
          clientId: 'client-1',
          warehouseId: 'warehouse-a',
          status: InventorySessionStatus.ACTIVE,
        }),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'box-b',
          clientId: 'client-1',
          warehouseId: 'warehouse-b',
          code: 'BOX-B',
          status: 'active',
          client: { id: 'client-1', name: 'Клиент' },
        }),
      },
      inventoryAuditBox: { findUnique: vi.fn() },
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await expect(service.openBox('session-a', 'BOX-B', branchManager))
      .rejects.toThrow('Короб не найден в активном филиале.');
    expect(prisma.inventoryAuditBox.findUnique).not.toHaveBeenCalled();
  });

  it('rejects item scans through an audit box from another branch', async () => {
    const prisma = {
      inventoryAuditBox: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'audit-b',
          clientId: 'client-1',
          status: InventoryBoxStatus.COUNTING,
          session: {
            status: InventorySessionStatus.ACTIVE,
            warehouseId: 'warehouse-b',
          },
        }),
      },
      sku: { findFirst: vi.fn() },
    };
    const service = new InventoryService(prisma as never, {} as never, {} as never);

    await expect(service.scanItem('audit-b', { barcode: '4600000000000' }, branchManager))
      .rejects.toThrow('Инвентаризация относится к другому филиалу.');
    expect(prisma.sku.findFirst).not.toHaveBeenCalled();
  });

  it('rejects reconciliation of a line from another branch', async () => {
    const update = vi.fn();
    const prisma = {
      inventoryAuditLine: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'line-b',
          auditBoxId: 'audit-b',
          auditBox: {
            clientId: 'client-1',
            session: {
              type: InventorySessionType.BOX_CHECK,
              status: InventorySessionStatus.REVIEW,
              warehouseId: 'warehouse-b',
            },
          },
        }),
        update,
      },
    };
    const service = new InventoryService(prisma as never, {} as never, {} as never);

    await expect(service.decideLine(
      'line-b',
      { action: InventoryResolutionAction.ACCEPT_AS_IS },
      branchManager,
    )).rejects.toThrow('Инвентаризация относится к другому филиалу.');
    expect(update).not.toHaveBeenCalled();
  });
});

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

describe('InventoryService box checks', () => {
  it('deduplicates a missing-pallet-box signal until manager review is resolved', async () => {
    const existing = {
      id: 'missing-box-check-1',
      type: InventorySessionType.BOX_CHECK,
      status: InventorySessionStatus.REVIEW,
      title: 'СИГНАЛ ТСД: на паллете нет короба FFL_LKB1508_02',
    };
    const create = vi.fn();
    const findFirst = vi.fn().mockResolvedValue(existing);
    const prisma = { inventorySession: { findFirst, create } };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await expect(service.startSession({
      type: InventorySessionType.BOX_CHECK,
      clientId: 'client-1',
      title: existing.title,
      comment: '[FBS_MISSING_PALLET_BOX] Короб: FFL_LKB1508_02; паллетсорт: PS-1',
    }, manager)).resolves.toBe(existing);

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: InventorySessionType.BOX_CHECK,
        status: { in: [InventorySessionStatus.ACTIVE, InventorySessionStatus.REVIEW] },
        clientId: 'client-1',
        title: existing.title,
        comment: { contains: '[FBS_MISSING_PALLET_BOX]' },
      }),
    }));
    expect(create).not.toHaveBeenCalled();
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
        count: vi.fn().mockImplementation(({ where }) =>
          Promise.resolve(where.status === InventoryBoxStatus.COUNTING ? 0 : 1),
        ),
      },
      inventoryAuditLine: { count: vi.fn().mockResolvedValue(2) },
    };
    const service = new InventoryService(prisma as never, {} as never, {} as never);

    await service.sendToReview('session-1', manager);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: InventorySessionStatus.REVIEW, completedAt: null }),
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
    // TEST: Prisma returns PENDING/decidedAt for an unresolved line, never undefined.
    const auditBox = {
      id: 'audit-box-1', boxId: 'box-1', clientId: 'client-1', sessionId: 'session-1',
      status: InventoryBoxStatus.MISMATCH, session: { warehouseId: null }, lines: [],
    };
    const lineUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const boxUpdate = vi.fn().mockResolvedValue({ ...auditBox, status: InventoryBoxStatus.RESOLVED });
    const prisma = {
      inventoryAuditLine: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'line-1',
          auditBoxId: 'audit-box-1',
          difference: -1,
          decision: InventoryLineDecision.PENDING,
          decidedAt: null,
          auditBox: {
            clientId: 'client-1',
            session: {
              type: InventorySessionType.BOX_CHECK,
              status: InventorySessionStatus.COMPLETED,
            },
          },
        }),
        updateMany: lineUpdate,
        count: vi.fn().mockResolvedValue(0),
      },
      inventoryAuditBox: {
        update: boxUpdate,
        findUnique: vi.fn().mockResolvedValue(auditBox),
      },
      inventorySession: { findUnique: vi.fn().mockResolvedValue(null) },
      box: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      stockMovement: { create: vi.fn() },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(prisma)),
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await service.decideLine(
      'line-1',
      { action: InventoryResolutionAction.ACCEPT_AS_IS },
      manager,
    );

    expect(lineUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'line-1', decision: InventoryLineDecision.PENDING, decidedAt: null },
      data: expect.objectContaining({ decision: InventoryLineDecision.KEEP_SYSTEM }),
    }));
    expect(boxUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: InventoryBoxStatus.RESOLVED }),
    }));
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
  });

  // TEST: correcting a PENDING fixture must not permit replacing a real final decision.
  it('does not replace an already applied decision in a completed box check', async () => {
    const prisma = {
      inventoryAuditLine: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'line-final', auditBoxId: 'audit-box-1',
          decision: InventoryLineDecision.APPLY_ACTUAL,
          decisionComment: '[APPLY_ACTUAL]', decidedAt: new Date('2026-09-01T10:00:00Z'),
          auditBox: {
            clientId: 'client-1',
            session: { type: InventorySessionType.BOX_CHECK, status: InventorySessionStatus.COMPLETED },
          },
        }),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(),
      stockMovement: { create: vi.fn() },
    };
    const service = new InventoryService(prisma as never, { requireClientAccess: vi.fn() } as never, {} as never);

    await expect(service.decideLine('line-final', { action: InventoryResolutionAction.ACCEPT_AS_IS }, manager))
      .rejects.toThrow('Решение по позиции уже применено (APPLY_ACTUAL)');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.inventoryAuditLine.updateMany).not.toHaveBeenCalled();
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
  });

  // ADDED: prevents an actualized receiving box from remaining invisible to whole-box transfers.
  it('reactivates only a receiving box that has a positive available balance after actualization', async () => {
    const activateBox = vi.fn().mockResolvedValue({ count: 1 });
    const auditBox = {
      id: 'audit-box-1',
      boxId: 'box-1',
      clientId: 'client-1',
      sessionId: 'session-1',
      status: InventoryBoxStatus.MATCHED,
      session: { warehouseId: null },
      lines: [],
    };
    const prisma = {
      inventorySession: { findUnique: vi.fn().mockResolvedValue(null) },
      // TEST: resolution and receiving-box activation share the transaction boundary.
      inventoryAuditLine: { count: vi.fn().mockResolvedValue(0) },
      inventoryAuditBox: {
        findUnique: vi.fn().mockResolvedValue(auditBox),
        update: vi.fn().mockResolvedValue({ ...auditBox, status: InventoryBoxStatus.RESOLVED }),
      },
      box: { updateMany: activateBox },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(prisma)),
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await service.resolveBox(
      'audit-box-1',
      { action: InventoryResolutionAction.APPLY_ACTUAL },
      administrator,
    );

    expect(activateBox).toHaveBeenCalledWith({
      where: {
        id: 'box-1',
        clientId: 'client-1',
        status: 'receiving',
        balances: {
          some: {
            clientId: 'client-1',
            status: 'AVAILABLE',
            quantity: { gt: 0 },
          },
        },
      },
      data: { status: 'active' },
    });
  });

  // ADDED: a matched recount is already final, so its receiving box must become usable immediately.
  it('reactivates a receiving box with positive available stock when finishBox finds no mismatch', async () => {
    const activationOperation = Promise.resolve({ count: 1 });
    const activateBox = vi.fn().mockReturnValue(activationOperation);
    const transaction = vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
    const auditBox = {
      id: 'audit-box-1',
      boxId: 'box-1',
      clientId: 'client-1',
      sessionId: 'session-1',
      status: InventoryBoxStatus.COUNTING,
      session: {
        status: InventorySessionStatus.ACTIVE,
        warehouseId: 'warehouse-1',
      },
    };
    const prisma = {
      inventorySession: { findUnique: vi.fn().mockResolvedValue(null) },
      inventoryAuditBox: {
        findUnique: vi.fn().mockResolvedValue(auditBox),
        update: vi.fn().mockResolvedValue({ ...auditBox, status: InventoryBoxStatus.MATCHED }),
      },
      inventoryAuditLine: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'line-1', expectedQuantity: 2, countedQuantity: 2 },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      box: { updateMany: activateBox },
      $transaction: transaction,
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await service.finishBox('audit-box-1', manager);

    expect(activateBox).toHaveBeenCalledWith({
      where: {
        id: 'box-1',
        clientId: 'client-1',
        status: 'receiving',
        warehouseId: 'warehouse-1',
        balances: {
          some: {
            clientId: 'client-1',
            warehouseId: 'warehouse-1',
            status: 'AVAILABLE',
            quantity: { gt: 0 },
          },
        },
      },
      data: { status: 'active' },
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction.mock.calls[0][0]).toContain(activationOperation);
    expect(transaction.mock.calls[0][0]).toHaveLength(3);
  });

  // ADDED: unresolved discrepancies must never make the physical box active again.
  it('does not reactivate a box when finishBox finds a mismatch', async () => {
    const activateBox = vi.fn().mockResolvedValue({ count: 0 });
    const transaction = vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
    const auditBox = {
      id: 'audit-box-1',
      boxId: 'box-1',
      clientId: 'client-1',
      sessionId: 'session-1',
      status: InventoryBoxStatus.COUNTING,
      session: {
        status: InventorySessionStatus.ACTIVE,
        warehouseId: null,
      },
    };
    const prisma = {
      inventoryAuditBox: {
        findUnique: vi.fn().mockResolvedValue(auditBox),
        update: vi.fn().mockResolvedValue({ ...auditBox, status: InventoryBoxStatus.MISMATCH }),
      },
      inventoryAuditLine: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'line-1', expectedQuantity: 2, countedQuantity: 1 },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      box: { updateMany: activateBox },
      $transaction: transaction,
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await service.finishBox('audit-box-1', manager);

    expect(activateBox).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction.mock.calls[0][0]).toHaveLength(2);
  });

  // ADDED: the caller must see an activation failure from the same transactional batch.
  it('rejects finishBox when its transactional box activation fails', async () => {
    const activationError = new Error('activation transaction failed');
    const activationOperation = Promise.reject(activationError);
    void activationOperation.catch(() => undefined);
    const activateBox = vi.fn().mockReturnValue(activationOperation);
    const transaction = vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
    const auditBox = {
      id: 'audit-box-1',
      boxId: 'box-1',
      clientId: 'client-1',
      sessionId: 'session-1',
      status: InventoryBoxStatus.COUNTING,
      session: {
        status: InventorySessionStatus.ACTIVE,
        warehouseId: null,
      },
    };
    const prisma = {
      inventoryAuditBox: {
        findUnique: vi.fn().mockResolvedValue(auditBox),
        update: vi.fn().mockResolvedValue({ ...auditBox, status: InventoryBoxStatus.MATCHED }),
      },
      inventoryAuditLine: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'line-1', expectedQuantity: 2, countedQuantity: 2 },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      box: { updateMany: activateBox },
      $transaction: transaction,
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await expect(service.finishBox('audit-box-1', manager)).rejects.toThrow(
      'activation transaction failed',
    );

    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction.mock.calls[0][0]).toContain(activationOperation);
    expect(activateBox).toHaveBeenCalledWith({
      where: {
        id: 'box-1',
        clientId: 'client-1',
        status: 'receiving',
        balances: {
          some: {
            clientId: 'client-1',
            status: 'AVAILABLE',
            quantity: { gt: 0 },
          },
        },
      },
      data: { status: 'active' },
    });
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

  // TEST: mass maintenance may finish only sessions whose every box is already
  // MATCHED/RESOLVED and whose mismatch decisions are all resolved.
  it('завершает только фактически законченную инвентаризацию выбранных коробов', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'session-ready' }]),
      inventorySession: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'session-ready',
          status: InventorySessionStatus.REVIEW,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryAuditBox: {
        count: vi.fn()
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(0),
      },
      inventoryAuditLine: { count: vi.fn().mockResolvedValue(0) },
    };
    const prisma = {
      inventorySession: {
        findMany: vi.fn().mockResolvedValue([{ id: 'session-ready' }]),
      },
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new InventoryService(prisma as never, {} as never, {} as never);

    const result = await service.completeResolvedSessionsForBoxes(['box-1', 'box-2'], administrator);

    expect(result).toEqual({ checked: 1, completed: 1, sessionIds: ['session-ready'] });
    expect(tx.inventoryAuditBox.count).toHaveBeenNthCalledWith(2, {
      where: {
        sessionId: 'session-ready',
        status: { notIn: [InventoryBoxStatus.MATCHED, InventoryBoxStatus.RESOLVED] },
      },
    });
    expect(tx.inventorySession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'session-ready',
        status: { in: [InventorySessionStatus.ACTIVE, InventorySessionStatus.REVIEW] },
      },
    }));
  });

  // TEST: a COUNTING/MISMATCH box keeps the session open even when the session is old.
  it('не завершает инвентаризацию с незавершённым коробом', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'session-live' }]),
      inventorySession: {
        findFirst: vi.fn().mockResolvedValue({ id: 'session-live', status: InventorySessionStatus.ACTIVE }),
        updateMany: vi.fn(),
      },
      inventoryAuditBox: {
        count: vi.fn()
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(1),
      },
      inventoryAuditLine: { count: vi.fn().mockResolvedValue(0) },
    };
    const prisma = {
      inventorySession: { findMany: vi.fn().mockResolvedValue([{ id: 'session-live' }]) },
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    };
    const service = new InventoryService(prisma as never, {} as never, {} as never);

    const result = await service.completeResolvedSessionsForBoxes(['box-live'], administrator);

    expect(result).toEqual({ checked: 1, completed: 0, sessionIds: [] });
    expect(tx.inventorySession.updateMany).not.toHaveBeenCalled();
  });
});

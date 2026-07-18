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

describe('InventoryService box checks', () => {
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
      inventoryAuditBox: { count: vi.fn().mockResolvedValue(0) },
      inventoryAuditLine: { count: vi.fn().mockResolvedValue(2) },
    };
    const service = new InventoryService(prisma as never, {} as never, {} as never);

    await service.sendToReview('session-1', manager);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: InventorySessionStatus.REVIEW, completedAt: null }),
    }));
  });

  it('allows a manager to resolve a mismatch from an already completed box check', async () => {
    const lineUpdate = vi.fn().mockResolvedValue({});
    const boxUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
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

  it('does not allow a completed box to be checked again', async () => {
    const prisma = {
      inventorySession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-1',
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
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new InventoryService(prisma as never, scopes as never, {} as never);

    await expect(service.openBox('session-1', 'FFL_BOX_1', manager))
      .rejects.toThrow('Короб FFL_BOX_1 уже проверен. Повторная проверка запрещена.');
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
});

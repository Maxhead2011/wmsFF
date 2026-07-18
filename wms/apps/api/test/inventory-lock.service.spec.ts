import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { InventoryLockService } from '../src/common/inventory/inventory-lock.service';

describe('InventoryLockService', () => {
  it('разрешает движения, когда полной инвентаризации нет', async () => {
    const prisma = {
      inventorySession: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new InventoryLockService(prisma as never);

    await expect(service.assertStockMovementsAllowed()).resolves.toBeUndefined();
  });

  it('блокирует движения на активной полной инвентаризации', async () => {
    const prisma = {
      inventorySession: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inventory-1',
          title: 'Полная проверка',
          status: 'ACTIVE',
          startedAt: new Date(),
          createdByName: 'Менеджер',
        }),
      },
    };
    const service = new InventoryLockService(prisma as never);

    await expect(service.assertStockMovementsAllowed()).rejects.toBeInstanceOf(ConflictException);
  });
});

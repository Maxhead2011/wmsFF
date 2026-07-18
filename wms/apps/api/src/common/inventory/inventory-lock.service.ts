import { ConflictException, Injectable } from '@nestjs/common';
import { InventorySessionStatus, InventorySessionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InventoryLockService {
  constructor(private readonly prisma: PrismaService) {}

  async activeFullInventory() {
    return this.prisma.inventorySession.findFirst({
      where: {
        type: InventorySessionType.FULL,
        status: { in: [InventorySessionStatus.ACTIVE, InventorySessionStatus.REVIEW] },
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true, title: true, status: true, startedAt: true, createdByName: true },
    });
  }

  async assertStockMovementsAllowed() {
    const active = await this.activeFullInventory();
    if (!active) {
      return;
    }

    throw new ConflictException({
      code: 'FULL_INVENTORY_LOCK',
      message: `Движения товара временно заблокированы: выполняется полная инвентаризация «${active.title}».`,
      inventory: active,
    });
  }
}

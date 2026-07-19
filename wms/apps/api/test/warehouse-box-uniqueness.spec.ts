import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WarehouseService } from '../src/modules/warehouse/warehouse.service';

describe('WarehouseService: уникальность номера короба', () => {
  it('не открывает на приемке короб, номер которого уже существует', async () => {
    const tx = {
      box: {
        findFirst: vi.fn().mockResolvedValue({ id: 'box-1', clientId: 'other-client', status: 'active' }),
        create: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new WarehouseService(prisma as never, clientScopes as never, {} as never, {} as never, {} as never, {} as never);

    await expect(
      service.openOnlineReceiptBox(
        { clientId: 'client-1', boxCode: 'FFL_BOX_1', sourceDocument: 'RECEIPT-1' },
        { id: 'user-1', email: 'operator@example.test' } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.box.create).not.toHaveBeenCalled();
  });

  it('берёт последние операции онлайн-приёмки, чтобы новая партия не терялась за лимитом', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ id: 'client-1', onlineReceiptVisibleToClient: true }),
      },
      tsdOperation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      box: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new WarehouseService(
      prisma as never,
      clientScopes as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.listOnlineReceipts(
      { clientId: 'client-1' },
      { id: 'user-1', permissionCodes: [], roleCodes: ['CLIENT'] } as never,
    );

    expect(prisma.tsdOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        take: 10000,
      }),
    );
  });
});

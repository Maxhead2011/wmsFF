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
    const boxCodes = {
      requireAllowed: vi.fn(async (value: string) => value),
      getPolicy: vi.fn(async () => ({ allowedPrefixes: ['FFL_'] })),
    };
    const service = new WarehouseService(
      prisma as never,
      clientScopes as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      boxCodes as never,
    );

    await expect(
      service.openOnlineReceiptBox(
        { clientId: 'client-1', boxCode: 'FFL_BOX_1', sourceDocument: 'RECEIPT-1' },
        // TEST: reach the duplicate-number guard with a valid non-admin warehouse scope.
        {
          id: 'user-1', email: 'operator@example.test', name: 'Operator',
          roleCodes: ['OPERATOR'], permissionCodes: ['stock:write'],
          clientScopeMode: 'LIMITED', clientIds: ['client-1'], writableClientIds: ['client-1'],
          activeWarehouseId: 'warehouse-1', warehouseIds: ['warehouse-1'],
          writableWarehouseIds: ['warehouse-1'],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.box.findFirst).toHaveBeenCalledWith({
      where: { code: 'FFL_BOX_1' },
      select: { id: true, clientId: true, status: true },
    });
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
      {
        getPolicy: vi.fn().mockResolvedValue({ receiptPrefix: 'FFL_LKB' }),
      } as never,
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

import 'reflect-metadata';
import { StockStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TurnoverActionKind } from '../src/modules/turnover/dto/turnover-action.dto';
import { TurnoverService } from '../src/modules/turnover/turnover.service';

describe('TurnoverService boxless stock sentinel', () => {
  // TEST: the UI label "Без короба" must never become a physical Box record.
  it('adds stock to the real boxless balance when the target contains the UI label', async () => {
    const boxFindUnique = vi.fn().mockResolvedValue(null);
    const boxCreate = vi.fn().mockResolvedValue({
      id: 'wrong-box',
      code: 'Без короба',
      warehouseId: 'warehouse-1',
      palletId: null,
    });
    const balanceUpsert = vi.fn().mockResolvedValue({ id: 'balance-1', quantity: 97 });
    const movementCreate = vi.fn().mockResolvedValue({ id: 'movement-1' });
    const tx = {
      stockMovement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: movementCreate,
      },
      sku: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'sku-white',
          clientId: 'client-1',
          name: 'Осушитель воздуха для дома',
          barcodes: [],
        }),
      },
      box: {
        findUnique: boxFindUnique,
        create: boxCreate,
      },
      stockBalance: { upsert: balanceUpsert },
      productMark: { upsert: vi.fn() },
    };
    const prisma = {
      client: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'client-1',
          warehouseLinks: [{ warehouseId: 'warehouse-1' }],
        }]),
      },
      $transaction: vi.fn((callback: (database: typeof tx) => unknown) => callback(tx)),
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new TurnoverService(prisma as never, clientScopes as never);

    await expect(service.runAction({
      clientId: 'client-1',
      skuId: 'sku-white',
      action: TurnoverActionKind.ADD,
      quantity: 96,
      targetBoxCode: '  Без короба  ',
      idempotencyKey: 'turnover-boxless-white',
    }, adminUser)).resolves.toMatchObject({
      status: 'APPLIED',
      targetBoxCode: null,
    });

    expect(boxFindUnique).not.toHaveBeenCalled();
    expect(boxCreate).not.toHaveBeenCalled();
    expect(balanceUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        warehouseId: 'warehouse-1',
        boxId: null,
        palletId: null,
        status: StockStatus.AVAILABLE,
        quantity: 96,
      }),
    }));
    expect(movementCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        boxId: null,
        palletId: null,
        quantity: 96,
      }),
    }));
  });
});

const adminUser: AuthUser = {
  id: 'admin-1',
  email: 'admin@example.test',
  name: 'Администратор',
  roleCodes: ['ADMIN'],
  permissionCodes: ['system:admin'],
  clientScopeMode: 'ALL',
  clientIds: [],
  writableClientIds: [],
  activeWarehouseId: 'warehouse-1',
  warehouseIds: ['warehouse-1'],
  writableWarehouseIds: ['warehouse-1'],
};

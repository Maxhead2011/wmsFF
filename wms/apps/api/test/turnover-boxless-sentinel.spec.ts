import 'reflect-metadata';
import { StockStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TurnoverActionKind } from '../src/modules/turnover/dto/turnover-action.dto';
import { TurnoverService } from '../src/modules/turnover/turnover.service';

describe('TurnoverService boxless stock sentinel', () => {
  // TEST: current balances exclude archived/deleted boxes for staff, without hiding history.
  it('excludes archived boxes for administrators while retaining boxless stock and history', () => {
    const { service } = sourceFixture();
    expect((service as any).balanceVisibilityWhere(adminUser)).toMatchObject({ AND: [
      { OR: [{ boxId: null }, { box: { status: { notIn: ['archived', 'deleted'] } } }] },
    ] });
    expect((service as any).movementVisibilityWhere(adminUser)).toBeUndefined();
  });
  // TEST: explicit boxless source must never resolve a Box or consume boxed stock.
  it.each(['Без короба', '  БЕЗ КОРОБА  '])('writes off only boxless stock for %s', async source => {
    const { service, tx } = sourceFixture();
    await (service as any).decrementAvailable(tx, 'client-1', 'sku-1', 1, source,
      { warehouseId: 'warehouse-1', boxlessClientIds: ['client-1'] });
    expect(tx.box.findUnique).not.toHaveBeenCalled();
    const where = tx.stockBalance.findMany.mock.calls[0][0].where;
    expect(where.boxId).toBeNull();
    expect(where.OR).toContainEqual({ warehouseId: 'warehouse-1' });
    expect(where.status.in).not.toContain('SHIPPING');
  });

  // TEST: an actual box and an unspecified source keep their existing scopes.
  it.each([['BOX-1', 'box-1'], ['', undefined]])('preserves source scope %s', async (source, expected) => {
    const { service, tx } = sourceFixture();
    tx.box.findUnique.mockResolvedValue({ id: 'box-1', warehouseId: 'warehouse-1' });
    await (service as any).decrementAvailable(tx, 'client-1', 'sku-1', 1, source,
      { warehouseId: 'warehouse-1', boxlessClientIds: ['client-1'] });
    expect(tx.stockBalance.findMany.mock.calls[0][0].where.boxId).toBe(expected);
  });
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

function sourceFixture() {
  const tx = {
    box: { findUnique: vi.fn().mockResolvedValue(null) },
    stockBalance: {
      findMany: vi.fn().mockResolvedValue([{ id: 'balance-1', quantity: 4, boxId: null }]),
      update: vi.fn().mockResolvedValue({ quantity: 3 }), delete: vi.fn(),
    },
  };
  return { tx, service: new TurnoverService({} as never, {} as never) };
}

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

import { describe, expect, it, vi } from 'vitest';
import { TurnoverService } from '../src/modules/turnover/turnover.service';

describe('TurnoverService hidden administrative write-off', () => {
  // TEST: the main web turnover table totals only placed target-client balances and KIZs.
  it('скрывает непривязанные остатки Лукина из основной таблицы товарооборота', async () => {
    const skuFindMany = vi.fn(async () => []);
    const prisma = { sku: { findMany: skuFindMany } };
    const clientScopes = {
      resolveClientFilter: vi.fn(() => 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9'),
    };
    const service = new TurnoverService(prisma as never, clientScopes as never);

    await service.list({ clientId: 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9' } as never, lukinUser());

    expect(skuFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          balances: expect.objectContaining({
            where: expect.objectContaining({
              AND: expect.arrayContaining([expect.objectContaining({ OR: expect.any(Array) })]),
            }),
          }),
          productMarks: expect.objectContaining({
            where: expect.objectContaining({
              AND: expect.arrayContaining([expect.objectContaining({ OR: expect.any(Array) })]),
            }),
          }),
        }),
      }),
    );
  });

  // TEST: box details themselves are unavailable for an unplaced target-client box.
  it('не открывает клиенту Лукина карточку непривязанного короба', async () => {
    const boxFindFirst = vi.fn(async () => null);
    const prisma = { box: { findFirst: boxFindFirst } };
    const clientScopes = {
      resolveClientFilter: vi.fn(() => 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9'),
    };
    const service = new TurnoverService(prisma as never, clientScopes as never);

    await expect(
      service.boxDetails(
        'FFL_UNPLACED',
        { clientId: 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9' } as never,
        lukinUser(),
      ),
    ).rejects.toThrow('Короб не найден');

    expect(boxFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              clientId: 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',
              storagePlacement: { isNot: null },
            }),
          ]),
        }),
      }),
    );
  });

  // TEST: autocomplete cannot bypass list/box privacy and disclose quantities, KIZs or box codes.
  it('скрывает непривязанные остатки Лукина из подсказок товарооборота', async () => {
    const skuFindMany = vi.fn(async () => []);
    const markFindMany = vi.fn(async () => []);
    const boxFindMany = vi.fn(async () => []);
    const prisma = {
      sku: { findMany: skuFindMany },
      barcode: { findMany: vi.fn(async () => []) },
      productMark: { findMany: markFindMany },
      box: { findMany: boxFindMany },
    };
    const clientScopes = {
      resolveClientFilter: vi.fn(() => 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9'),
    };
    const service = new TurnoverService(prisma as never, clientScopes as never);

    await service.suggestions(
      { clientId: 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9', scope: 'product' } as never,
      lukinUser(),
    );

    expect(skuFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          balances: expect.objectContaining({
            where: expect.objectContaining({
              AND: expect.arrayContaining([expect.objectContaining({ OR: expect.any(Array) })]),
            }),
          }),
        }),
      }),
    );
    expect(markFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([expect.objectContaining({ OR: expect.any(Array) })]),
        }),
      }),
    );
    expect(boxFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([expect.objectContaining({ OR: expect.any(Array) })]),
        }),
      }),
    );
  });

  // TEST: a CLIENT user must not receive the internal cleanup movement in box history.
  it('filters the internal source from client box details', async () => {
    const movementFindMany = vi.fn(async () => []);
    const prisma = {
      box: {
        findFirst: vi.fn(async () => ({
          id: 'box-1',
          code: 'FFL_LKB_1',
          status: 'archived',
          client: { id: 'client-1', code: 'CL-1', name: 'Client' },
          storagePlacement: null,
        })),
      },
      stockBalance: { findMany: vi.fn(async () => []) },
      productMark: { findMany: vi.fn(async () => []) },
      stockMovement: { findMany: movementFindMany },
    };
    const clientScopes = {
      resolveClientFilter: vi.fn(() => 'client-1'),
    };
    const service = new TurnoverService(prisma as never, clientScopes as never);

    await service.boxDetails('FFL_LKB_1', { clientId: 'client-1' } as never, {
      id: 'client-user',
      name: 'Client',
      email: 'client@example.com',
      roleCodes: ['CLIENT'],
      permissionCodes: ['stock:read'],
      clientScopeMode: 'LIMITED',
      clientIds: ['client-1'],
      writableClientIds: [],
    });

    expect(movementFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { sourceDocument: null },
            { sourceDocument: { not: 'admin-unpalleted-writeoff' } },
          ],
        }),
      }),
    );
  });
});

function lukinUser() {
  return {
    id: 'client-lukin',
    name: 'ИП Лукин Илья Ильич',
    email: 'lukin@example.com',
    roleCodes: ['CLIENT'],
    permissionCodes: ['stock:read'],
    clientScopeMode: 'LIMITED',
    clientIds: ['c76b78f9-1b83-4e9b-bee3-bc28336ee1c9'],
    writableClientIds: [],
  } as never;
}

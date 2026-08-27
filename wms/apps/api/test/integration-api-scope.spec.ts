import { describe, expect, it, vi } from 'vitest';
import { StockStatus } from '@prisma/client';
import { IntegrationApiService } from '../src/modules/integration-api/integration-api.service';

describe('IntegrationApiService scope isolation', () => {
  it('always scopes stock reads to the client and warehouse embedded in the key', async () => {
    // TEST: query parameters can never switch an external key into another tenant or branch.
    const findMany = vi.fn(async () => []);
    const service = new IntegrationApiService(
      { stockBalance: { findMany } } as never,
      {} as never,
    );

    await service.stocks(context(['stock:read']), { status: StockStatus.AVAILABLE, limit: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client-1',
          warehouseId: 'warehouse-1',
          status: StockStatus.AVAILABLE,
        }),
      }),
    );
  });

  it('rejects stock reads when the key does not have stock:read', async () => {
    const service = new IntegrationApiService({} as never, {} as never);

    await expect(service.stocks(context(['catalog:read']), {})).rejects.toMatchObject({
      response: expect.objectContaining({ requiredScope: 'stock:read' }),
    });
  });

  // TEST: Lukin's client API never exposes balances from boxes outside pallet-sorts.
  it('hides unplaced Lukin boxes from integration stock', async () => {
    const findMany = vi.fn(async () => []);
    const service = new IntegrationApiService(
      { stockBalance: { findMany } } as never,
      {} as never,
    );

    await service.stocks(
      context(['stock:read'], 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9'),
      { limit: 10 },
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                { clientId: { not: 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9' } },
                {
                  clientId: 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',
                  boxId: { not: null },
                  box: {
                    status: { notIn: ['deleted', 'archived'] },
                    storagePlacement: { isNot: null },
                  },
                },
              ],
            },
          ],
        }),
      }),
    );
  });

  // TEST: the client integration must not expose the hidden administrative write-off as an action.
  it('hides unpalleted administrative write-offs from movement history', async () => {
    const findMany = vi.fn(async () => []);
    const service = new IntegrationApiService(
      { stockMovement: { findMany } } as never,
      {} as never,
    );

    await service.movements(context(['movements:read']), { limit: 10 });

    expect(findMany).toHaveBeenCalledWith(
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

function context(
  scopes: Array<'catalog:read' | 'stock:read' | 'movements:read'>,
  clientId = 'client-1',
) {
  return {
    scopes,
    clientIp: '127.0.0.1',
    credential: {
      id: 'credential-1',
      name: 'Test',
      clientId,
      warehouseId: 'warehouse-1',
      keyPrefix: 'a1b2c3d4e5f6',
      keyHash: '00'.repeat(32),
      scopes,
      allowedIps: [],
      expiresAt: null,
      revokedAt: null,
      createdByUserId: null,
      lastUsedAt: null,
      lastUsedIp: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as never;
}

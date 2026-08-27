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
});

function context(scopes: Array<'catalog:read' | 'stock:read'>) {
  return {
    scopes,
    clientIp: '127.0.0.1',
    credential: {
      id: 'credential-1',
      name: 'Test',
      clientId: 'client-1',
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

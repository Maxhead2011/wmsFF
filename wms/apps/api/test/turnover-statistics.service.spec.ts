import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TurnoverService } from '../src/modules/turnover/turnover.service';

describe('TurnoverService statistics', () => {
  it('aggregates movements in PostgreSQL instead of loading the full movement history into Node.js', async () => {
    const prisma = {
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sku-1',
            clientId: 'client-1',
            internalSku: 'SKU-1',
            clientSku: 'CLIENT-1',
            article: 'ART-1',
            name: 'Товар',
            client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
            barcodes: [{ value: '460000000001', isPrimary: true }],
          },
        ]),
      },
      stockBalance: {
        groupBy: vi.fn().mockResolvedValue([{ skuId: 'sku-1', _sum: { quantity: 12 } }]),
      },
      stockMovement: {
        findMany: vi.fn(),
      },
      $queryRaw: vi.fn().mockResolvedValue([
        {
          skuId: 'sku-1',
          period: '2026-07',
          receivedQuantity: 20n,
          shippedQuantity: 7n,
          writtenOffQuantity: 1n,
        },
      ]),
    };
    const clientScopes = {
      resolveClientFilter: vi.fn().mockReturnValue('client-1'),
    };
    const service = new TurnoverService(prisma as never, clientScopes as never);
    const user: AuthUser = {
      id: 'admin-1',
      email: 'admin@example.test',
      name: 'Admin',
      roleCodes: ['ADMIN'],
      permissionCodes: ['system:admin'],
      clientScopeMode: 'ALL',
      clientIds: [],
      writableClientIds: [],
    };

    const result = await service.statistics({ clientId: 'client-1', groupBy: 'month' }, user);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.stockMovement.findMany).not.toHaveBeenCalled();
    expect(prisma.stockBalance.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['skuId'],
        _sum: { quantity: true },
      }),
    );
    expect(result.totals).toEqual({
      receivedQuantity: 20,
      shippedQuantity: 7,
      writtenOffQuantity: 1,
      currentQuantity: 12,
    });
    expect(result.rows[0]).toMatchObject({
      skuId: 'sku-1',
      primaryBarcode: '460000000001',
      receivedQuantity: 20,
      shippedQuantity: 7,
      writtenOffQuantity: 1,
      currentQuantity: 12,
    });
    expect(result.trend).toEqual([
      {
        period: '2026-07',
        receivedQuantity: 20,
        shippedQuantity: 7,
        writtenOffQuantity: 1,
      },
    ]);
  });
});

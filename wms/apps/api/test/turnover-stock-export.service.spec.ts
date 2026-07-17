import { ClientRequestStatus, StockStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TurnoverService } from '../src/modules/turnover/turnover.service';

describe('TurnoverService stock export reservations', () => {
  it('subtracts only outbound requests that are in work', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ id: 'client-1', code: 'CL-1', name: 'Client' }),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'balance-1',
            clientId: 'client-1',
            skuId: 'sku-1',
            boxId: 'box-1',
            palletId: null,
            status: StockStatus.AVAILABLE,
            quantity: 10,
            updatedAt: new Date('2026-07-13T10:00:00.000Z'),
            sku: {
              id: 'sku-1',
              internalSku: 'SKU-1',
              clientSku: null,
              article: null,
              name: 'Product',
              color: null,
              size: null,
              volumeLiters: null,
              barcodes: [{ value: '1234567890123', isPrimary: true }],
            },
            box: { id: 'box-1', code: 'FFL_TEST_1', status: 'ACTIVE' },
            pallet: null,
          },
        ]),
      },
      productMark: {
        groupBy: vi.fn().mockResolvedValue([]),
      },
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const clientScopes = {
      requireClientAccess: vi.fn(),
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

    await service.getStockXlsx({ clientId: 'client-1' }, user);

    expect(prisma.clientRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId: 'client-1',
          type: 'OUTBOUND',
          status: { in: [ClientRequestStatus.IN_WORK] },
        },
      }),
    );
  });
});

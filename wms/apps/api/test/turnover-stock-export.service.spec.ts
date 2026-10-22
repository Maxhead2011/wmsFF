import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { ClientRequestStatus, StockStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TurnoverService } from '../src/modules/turnover/turnover.service';

describe('TurnoverService stock export reservations', () => {
  it.each(['ADMIN','CLIENT'])('subtracts outbound reservations for %s readers', async role => {
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
    const clientScopes = new ClientScopeService();
    const service = new TurnoverService(prisma as never, clientScopes as never);
    const user: AuthUser = {
      id: 'admin-1',
      email: 'admin@example.test',
      name: 'Admin',
      roleCodes: [role],
      permissionCodes: role === 'ADMIN' ? ['system:admin'] : ['stock:read'],
      clientScopeMode: role === 'ADMIN' ? 'ALL' : 'LIMITED',
      clientIds: ['client-1'],
      writableClientIds: [],
    };

    // TEST: a read-only client can export its own stock, never another client's.
    if (role === 'CLIENT') {
      await expect(service.getStockXlsx({ clientId: 'foreign' }, user)).rejects.toThrow();
      expect(prisma.client.findUnique).not.toHaveBeenCalled();
      expect(prisma.stockBalance.findMany).not.toHaveBeenCalled();
    }
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

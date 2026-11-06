import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { ClientRequestStatus, StockStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TurnoverService } from '../src/modules/turnover/turnover.service';

describe('TurnoverService stock export reservations', () => {
  it.each([['ADMIN',false],['CLIENT',false],['CLIENT',true]])('exports stock for %s full=%s', async (role,full) => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ id: 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9', code: 'CL-1', name: 'Client' }),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'balance-1',
            clientId: 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',
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
      clientIds: ['c76b78f9-1b83-4e9b-bee3-bc28336ee1c9'],
      writableClientIds: [],
    };

    // TEST: a read-only client can export its own stock, never another client's.
    if (role === 'CLIENT') {
      await expect(service.getStockXlsx({ clientId: 'foreign' }, user)).rejects.toThrow();
      expect(prisma.client.findUnique).not.toHaveBeenCalled();
      expect(prisma.stockBalance.findMany).not.toHaveBeenCalled();
    }
    await service.getStockXlsx({ clientId: 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',ignoreActiveRequests:full?'true':'false' }, user);
    // TEST: full export keeps placement visibility while skipping reservation subtraction.
    if(full) {
      const where=JSON.stringify(prisma.stockBalance.findMany.mock.calls[0][0]);
      expect(where).toContain('storagePlacement');
      expect(where).toContain('archived');
      expect(prisma.clientRequest.findMany).not.toHaveBeenCalled();
      return;
    }

    expect(prisma.clientRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId: 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9',
          type: 'OUTBOUND',
          status: { in: [ClientRequestStatus.IN_WORK] },
        },
      }),
    );
  });
});

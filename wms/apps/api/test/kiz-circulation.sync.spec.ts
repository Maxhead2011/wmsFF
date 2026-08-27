import { BadRequestException } from '@nestjs/common';
import { MarketplaceType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { KizCirculationService } from '../src/modules/kiz-circulation/kiz-circulation.service';

const user = {
  id: 'user-1',
  email: 'owner@example.test',
  name: 'Владелец',
  roleCodes: ['OWNER'],
  permissionCodes: ['kiz-circulation:read', 'kiz-circulation:write'],
  clientScopeMode: 'ALL',
  clientIds: [],
  writableClientIds: [],
} satisfies AuthUser;

describe('KizCirculation sync period', () => {
  // ADDED: выбранный период WB ограничивает реальные отгрузки и не подмешивает другой маркетплейс.
  it('uses Moscow date boundaries and scopes shipments to Wildberries', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'client-1',
          code: 'CLIENT-1',
          name: 'Клиент',
          inn: '1234567890',
          kpp: null,
          clientKind: 'IP',
        }),
      },
      kizTrueApiConnection: { findUnique: vi.fn().mockResolvedValue(null) },
      shippedKizHistory: {
        findMany: vi.fn().mockResolvedValue([
          { assemblyId: 'assembly-wb' },
          { assemblyId: 'assembly-ozon' },
        ]),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'assembly-wb',
            marketplace: MarketplaceType.WILDBERRIES,
            connectionId: 'connection-wb',
            orderId: 'order-wb',
          },
          {
            id: 'assembly-ozon',
            marketplace: MarketplaceType.OZON,
            connectionId: 'connection-ozon',
            orderId: 'order-ozon',
          },
        ]),
      },
      fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue([]) },
      kizCirculationItem: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const marketplaces = { listFbsOrders: vi.fn().mockResolvedValue({ orders: [] }) };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new KizCirculationService(
      prisma as never,
      marketplaces as never,
      {} as never,
      clientScopes as never,
    );

    const result = await service.sync(
      'client-1',
      {
        periodFrom: '2026-08-01',
        periodTo: '2026-08-18',
        marketplace: MarketplaceType.WILDBERRIES,
      },
      user,
    );

    expect(prisma.shippedKizHistory.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-1',
        shippedAt: {
          gte: new Date('2026-08-01T00:00:00.000+03:00'),
          lte: new Date('2026-08-18T23:59:59.999+03:00'),
        },
      },
      orderBy: { shippedAt: 'desc' },
      take: 10_000,
    });
    expect(prisma.fbsOrderRequestLink.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-1',
        connectionId: { in: ['connection-wb'] },
        orderId: { in: ['order-wb'] },
      },
    });
    expect(prisma.kizCirculationItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ marketplace: MarketplaceType.WILDBERRIES }),
    }));
    expect(result).toMatchObject({
      scannedShipments: 1,
      periodFrom: '2026-08-01',
      periodTo: '2026-08-18',
      marketplace: MarketplaceType.WILDBERRIES,
    });
  });

  // ADDED: неверный диапазон останавливается до запроса WB и базы.
  it('rejects a reversed period before synchronization starts', async () => {
    const marketplaces = { listFbsOrders: vi.fn() };
    const service = new KizCirculationService(
      {} as never,
      marketplaces as never,
      {} as never,
      { requireClientAccess: vi.fn() } as never,
    );

    await expect(service.sync(
      'client-1',
      {
        periodFrom: '2026-08-18',
        periodTo: '2026-08-01',
        marketplace: MarketplaceType.WILDBERRIES,
      },
      user,
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(marketplaces.listFbsOrders).not.toHaveBeenCalled();
  });
});

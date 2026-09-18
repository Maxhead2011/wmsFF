import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { MarketplaceStockControlService } from '../src/modules/marketplace-connections/marketplace-stock-control.service';
describe('WB reserve publication integration', () => { afterEach(() => vi.restoreAllMocks());
  // TEST: the reserve is applied once to the pool, before actual warehouse PUT batches.
  it.each([
    { available: 10, lowStock: undefined, expected: [4, 3] },
    { available: 4, lowStock: { threshold: 5, reserveUnits: 1 }, expected: [2, 1] },
    { available: 5, lowStock: { threshold: 5, reserveUnits: 1 }, expected: [1, 1] },
  ])('applies one reserve before sending stock to warehouses: %j', async ({ available, lowStock, expected }) => {
    const publications = ['1', '2'].map(warehouseId => ({ id: warehouseId, clientId: 'c', connectionId: 'conn', warehouseId, skuId: 's', enabled: true, saleLimit: null, sku: { id: 's', marketplaceProductId: '10:20' } }));
    const db: any = { clientMarketplaceConnection: { findFirst: vi.fn(async () => ({ id: 'conn', clientId: 'c', apiKey: 'test', fbsWarehouseId: '1' })) }, fbsStockPublication: { findMany: vi.fn(async () => publications), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({})) }, $transaction: async (items: any) => Promise.all(items) };
    const service: any = new MarketplaceConnectionsService(db, {} as never);
    service.stockAllocation = { activePolicy: vi.fn(async () => ({ id: 'policy', primaryWarehouseId: '1', lowStockThreshold: 0, overrides: [], shares: [{ warehouseId: '1', percent: 60, isPrimary: true }, { warehouseId: '2', percent: 40, isPrimary: false }] })), markSync: vi.fn() };
    vi.spyOn(service, 'resolveFbsExecutionWarehouseId').mockResolvedValue('msk');
    vi.spyOn(service, 'calculateFbsRelabelStockPlan').mockResolvedValue({ reserve: { mode: 'UNITS', value: 3, lowStock }, quantities: new Map([['s', { skuId: 's', chrtId: 20, sellable: available }]]), meta: new Map() });
    const send = vi.spyOn(service, 'putWildberriesStocks').mockResolvedValue({});
    const result = await service.syncAllocatedFbsStocksForConnection('c', 'conn');
    expect(result.publishedAmount).toBe(expected[0] + expected[1]);
    expect(send).toHaveBeenCalledWith('c', 'test', '1', [{ chrtId: 20, amount: expected[0] }]);
    expect(send).toHaveBeenCalledWith('c', 'test', '2', [{ chrtId: 20, amount: expected[1] }]);
  });
// TEST: the original sender published 15, leaving no additional client reserve.
  it('applies client reserve to the actual manual WB publication', async () => {
    const publication = {
      id: 'publication-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      warehouseId: '1693195',
      skuId: 'sku-1',
      enabled: true,
    };
    const prisma = {
      sku: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'sku-1',
          marketplaceProductId: '100500:200600',
        }),
      },
      fbsStockPublication: {
        upsert: vi.fn().mockResolvedValue(publication),
        update: vi.fn().mockResolvedValue(publication),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new MarketplaceConnectionsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );
    vi.spyOn(service as any, 'loadFbsStockContext').mockResolvedValue({
      client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
      connections: [],
      connection: { id: 'connection-1', apiKey: 'secret' },
      warehouses: [],
      warehouse: { id: '1693195', name: 'Мой склад FBS тест' },
      connectedWarehouseId: '1693195',
      connectedWarehouseName: 'Мой склад FBS тест',
    });
    vi.spyOn(service as any, 'calculateFbsStockQuantities').mockResolvedValue(
      new Map([
        [
          'sku-1',
          {
            skuId: 'sku-1',
            chrtId: 200600,
            available: 18,
            reserved: 3,
            sellable: 15,
          },
        ],
      ]),
    );
    vi.spyOn(MarketplaceStockControlService.prototype, 'reserve').mockResolvedValue({ mode: 'UNITS', value: 3 });
    const putStocks = vi.spyOn(service as any, 'putWildberriesStocks').mockResolvedValue(undefined);

    const result = await service.updateFbsStockPublication(
      {
        clientId: 'client-1',
        connectionId: 'connection-1',
        warehouseId: '1693195',
        skuId: 'sku-1',
        enabled: true,
      },
      {
        id: 'admin-1',
        email: 'admin@example.test',
        name: 'Администратор',
        roleCodes: ['ADMIN'],
        permissionCodes: ['system:admin'],
        clientScopeMode: 'ALL',
        clientIds: [],
        writableClientIds: [],
      },
    );

    expect(putStocks).toHaveBeenCalledWith('client-1', 'secret', '1693195', [
      { chrtId: 200600, amount: 12 },
    ]);
    expect(result).toMatchObject({ updated: true, enabled: true, amount: 12 });
  });

});

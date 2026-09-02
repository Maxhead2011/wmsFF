import { describe, expect, it, vi } from 'vitest';
import { StorageOptimizationService } from '../src/modules/service/storage-optimization.service';

describe('StorageOptimizationService', () => {
  it('reads only positive available boxed stock and maps its pallet sort', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ id: 'client-lukin', code: 'LUKIN', name: 'Лукин Илья Ильич' }),
      },
      stockBalance: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 6 } }),
        findMany: vi.fn().mockResolvedValue([
          {
            warehouseId: 'warehouse-moscow',
            quantity: 18,
            warehouse: { id: 'warehouse-moscow', name: 'Москва', city: 'Москва' },
            pallet: null,
            box: {
              code: 'FFL_LKB001',
              warehouse: { id: 'warehouse-moscow', name: 'Москва', city: 'Москва' },
              pallet: null,
              storagePlacement: { pallet: { code: 'PALET_SORT_001' } },
            },
            sku: {
              id: 'sku-1',
              internalSku: 'M31-BLACK-M',
              article: 'M31',
              name: 'Костюм M31',
              color: 'Чёрный',
              size: 'M',
              barcodes: [{ value: '200000000001', isPrimary: true }],
            },
          },
        ]),
      },
    };
    const service = new StorageOptimizationService(prisma as never);

    const report = await service.buildReport('client-lukin');

    // TEST: reserved, shipped, zero and unboxed balances cannot enter the recommendation.
    expect(prisma.stockBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId: 'client-lukin',
          status: 'AVAILABLE',
          quantity: { gt: 0 },
          boxId: { not: null },
        },
      }),
    );
    expect(report.client).toEqual({ id: 'client-lukin', code: 'LUKIN', name: 'Лукин Илья Ильич' });
    expect(report.summary.excludedUnits).toBe(6);
    expect(prisma.stockBalance.aggregate).toHaveBeenCalledWith({
      where: {
        clientId: 'client-lukin',
        quantity: { gt: 0 },
        OR: [{ status: { not: 'AVAILABLE' } }, { boxId: null }],
      },
      _sum: { quantity: true },
    });
    expect(report.rows[0]).toMatchObject({
      barcode: '200000000001',
      article: 'M31',
      sourceBox: 'FFL_LKB001',
      sourcePalletSort: 'PALET_SORT_001',
      quantity: 18,
    });
  });
});

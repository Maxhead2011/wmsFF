import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRequestsService } from '../src/modules/client-requests/client-requests.service';

// TEST: accepted stock awaiting placement is reservable, but not ready to pick.
describe('FBO recent receipt availability', () => {
  afterEach(() => vi.unstubAllEnvs());
  function setup(reserved = 0) {
    vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
    const service: any = new ClientRequestsService({} as any, { requireClientAccess: vi.fn() } as any, {} as any);
    service.resolveRequestWarehouse = vi.fn().mockResolvedValue('w');
    service.isPrimaryMoscowWarehouse = vi.fn().mockResolvedValue(false);
    service.resolveAvailabilityItems = vi.fn().mockResolvedValue([{ index: 0, skuId: 's', requestedQuantity: 5 }]);
    service.stockQuantityBySkuId = vi.fn().mockResolvedValue(new Map([['s', 2]]));
    service.pendingPlacementBySkuId = vi.fn().mockResolvedValue(new Map([['s', 4]]));
    service.activeReservationBySkuId = vi.fn().mockResolvedValue(new Map([['s', { quantity: reserved, requests: [] }]]));
    return service;
  }
  const dto: any = { clientId: 'c', type: 'OUTBOUND', items: [{ skuId: 's', quantity: 5 }] };
  it('allows creation and reports placement separately from missing stock', async () => {
    const result = await setup().previewAvailability(dto, {});
    expect(result.canCommit).toBe(true);
    expect(result.lines[0]).toMatchObject({ availableQuantity: 6, readyQuantity: 2, pendingPlacementQuantity: 4, shortageQuantity: 0 });
  });
  it('subtracts existing reserves from the combined stock exactly once', async () => {
    const result = await setup(3).previewAvailability(dto, {});
    expect(result.canCommit).toBe(false);
    expect(result.lines[0]).toMatchObject({ availableQuantity: 3, readyQuantity: 0, pendingPlacementQuantity: 3, shortageQuantity: 2 });
  });
  it('keeps the sold installation unchanged', async () => {
    const service = setup(); vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'false');
    const result = await service.previewAvailability(dto, {});
    expect(result.canCommit).toBe(false);
    expect(service.pendingPlacementBySkuId).not.toHaveBeenCalled();
  });
  it('does not count the same pending stock twice for duplicate SKU rows', async () => {
    const service = setup();
    service.resolveAvailabilityItems.mockResolvedValue([{ index: 0, skuId: 's', requestedQuantity: 5 }, { index: 1, skuId: 's', requestedQuantity: 5 }]);
    const result = await service.previewAvailability(dto, {});
    expect(result.canCommit).toBe(false);
    expect(result.lines[1]).toMatchObject({ availableQuantity: 1, shortageQuantity: 4 });
  });
  it('counts only the remaining quantity supported by a recent committed receipt', async () => {
    vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED', 'false');
    const recent = new Date();
    const old = new Date(recent.getTime() - 8 * 86400000);
    const groupBy = vi.fn(async ({ where }: any) => [
      { boxId: 'fresh', skuId: 's', createdAt: recent, _sum: { quantity: 3 } },
      { boxId: 'old', skuId: 's', createdAt: old, _sum: { quantity: 20 } },
    ].filter(r => r.createdAt >= where.createdAt.gte && r.createdAt <= where.createdAt.lte));
    const prisma: any = { client: { findUniqueOrThrow: async () => ({ stockBalanceMode: 'PALLET_SORT' }) },
      stockBalance: { groupBy: vi.fn().mockResolvedValue([
        { boxId: 'fresh', skuId: 's', _sum: { quantity: 2 } },
        { boxId: 'old', skuId: 's', _sum: { quantity: 20 } },
        { boxId: 'no-receipt', skuId: 's', _sum: { quantity: 20 } },
      ]) }, stockMovement: { groupBy } };
    const service: any = new ClientRequestsService(prisma, {} as any, {} as any);
    expect(await service.pendingPlacementBySkuId('c', ['s'], 'w')).toEqual(new Map([['s', 2]]));
    expect(prisma.stockBalance.groupBy.mock.calls[0][0].where.box).toEqual({ clientId: 'c', warehouseId: 'w', status: 'active', storagePlacement: { is: null } });
    expect(groupBy.mock.calls[0][0].where).toMatchObject({ clientId: 'c', warehouseId: 'w', type: 'RECEIPT', status: 'AVAILABLE', quantity: { gt: 0 } });
  });
});

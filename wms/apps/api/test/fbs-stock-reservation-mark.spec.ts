import { MarketplaceType, StockStatus } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

const task = {
  id: 'task-current',
  marketplace: MarketplaceType.WILDBERRIES,
  completedAt: null,
  itemCount: 1,
  clientId: 'client-1',
  skuId: 'sku-1',
  boxId: 'box-live',
  boxCode: 'FFL_LKX32708_06',
  requestId: 'request-401',
  orderId: '5570593510',
  kiz: 'kiz-current',
};

describe('FBS stock reservation ProductMark synchronization', () => {
  afterEach(() => vi.unstubAllEnvs());
  // TEST: preserve the live safeguard; an unknown source cannot create a phantom reserve.
  it('does not reserve or mutate a KIZ when sourceBoxPending is true', async () => {
    vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'true');
    const findMany = vi.fn().mockResolvedValue([{ quantity: 1 }]);
    const updateMany = vi.fn();
    const service = new MarketplaceConnectionsService({} as never, {} as never);
    await (service as any).reserveCompletedWildberriesStock(
      { stockMovement: { findMany }, productMark: { updateMany } },
      { ...task, sourceBoxPending: true }, 'warehouse-1');
    expect(findMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
  // TEST: a picked KIZ must leave AVAILABLE together with its stock balance.
  it.each([false, true])('marks the exact picked KIZ as PACKING, lifecycle flag %s', async (enabled) => {
    // TEST: physical picking removes the active source association, not the task's history.
    vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', String(enabled));
    const productMarkUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'movement-1' }),
      },
      box: {
        update: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          id: 'box-live',
          code: 'FFL_LKX32708_06',
          warehouseId: 'warehouse-1',
          palletId: 'pallet-1',
        }),
      },
      stockBalance: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([{
          id: 'balance-available',
          warehouseId: 'warehouse-1',
          boxId: 'box-live',
          palletId: 'pallet-1',
          quantity: 1,
        }]),
        delete: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
        upsert: vi.fn().mockResolvedValue({}),
      },
      productMark: { updateMany: productMarkUpdateMany, count: vi.fn().mockResolvedValue(0) },
    };
    const service = new MarketplaceConnectionsService({} as never, {} as never);
    Object.assign(service, { boxCodes: { getPolicy: async () => ({ storageBoxPrefix: 'SBOX_', storageBoxAliases: ['FFL_LKBBOX'] }), normalize: async (code: string) => code } });

    await (service as any).reserveCompletedWildberriesStock(
      tx,
      task,
      'warehouse-1',
    );

    expect(productMarkUpdateMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-1',
        skuId: 'sku-1',
        value: 'kiz-current',
        status: StockStatus.AVAILABLE,
      },
      data: {
        status: StockStatus.PACKING,
        boxId: enabled ? null : 'box-live',
      },
    });
    expect(task.boxId).toBe('box-live');
    // TEST: physically picked stock is no longer stored inside its source location.
    expect(tx.stockBalance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ boxId: enabled ? null : 'box-live', palletId: enabled ? null : 'pallet-1' }),
    }));
  });

  // TEST: undoing the reservation restores the exact KIZ to AVAILABLE.
  it.each([false, true])('returns the exact KIZ to AVAILABLE when cancelled; lifecycle flag %s', async enabled => {
    vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', String(enabled));
    const productMarkUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([{
          warehouseId: 'warehouse-1',
          boxId: 'box-live',
          palletId: 'pallet-1',
          quantity: 1,
        }]),
        create: vi.fn().mockResolvedValue({ id: 'movement-1' }),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'balance-packing',
          warehouseId: 'warehouse-1',
          boxId: 'box-live',
          palletId: 'pallet-1',
          status: StockStatus.PACKING,
          quantity: 1,
        }]),
        delete: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
        upsert: vi.fn().mockResolvedValue({}),
      },
      productMark: { updateMany: productMarkUpdateMany },
    };
    const service = new MarketplaceConnectionsService({} as never, {} as never);

    await (service as any).returnCompletedWildberriesStockReservation(tx, task);

    expect(productMarkUpdateMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-1',
        skuId: 'sku-1',
        value: 'kiz-current',
        status: StockStatus.PACKING,
      },
      data: {
        status: StockStatus.AVAILABLE,
        boxId: enabled ? null : 'box-live',
      },
    });
  });
});

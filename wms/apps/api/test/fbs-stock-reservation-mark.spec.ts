import { MarketplaceType, StockStatus } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
// TEST: live deployment preserves existing boxless behavior even if its new feature is disabled.
const ourLiveBaseline = process.env.WMS_TEST_OUR_LIVE_BASELINE === 'true';

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
        boxId: enabled || ourLiveBaseline ? null : 'box-live',
      },
    });
    expect(task.boxId).toBe('box-live');
    // TEST: physically picked stock is no longer stored inside its source location.
    expect(tx.stockBalance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ boxId: enabled || ourLiveBaseline ? null : 'box-live', palletId: enabled || ourLiveBaseline ? null : 'pallet-1' }),
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
        boxId: enabled || ourLiveBaseline ? null : 'box-live',
      },
    });
  });
});

// TEST: real accepted-pick service, simulated transactional storage; no live DB/WB.
describe('FBS exact KIZ source at physical pick', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  function fixture(options: { wrongBox?: boolean; missing?: boolean; quantity?: number; loseMark?: boolean } = {}) {
    vi.stubEnv('WMS_FBS_PRESERVE_STOCK_KIZ', 'true');
    vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'true');
    const current = { ...task, boxCode: 'FFL_LKBBOX_016', status: 'IN_PROGRESS', wbMetaStatus: 'ACCEPTED' };
    let state = {
      available: options.quantity ?? 2, packing: 0,
      marks: [
        ...(!options.missing ? [{ clientId: task.clientId, skuId: task.skuId, value: task.kiz,
          boxId: options.wrongBox ? 'other-box' : task.boxId, status: 'AVAILABLE' }] : []),
        { clientId: task.clientId, skuId: task.skuId, value: 'other-physical-kiz', boxId: task.boxId, status: 'AVAILABLE' },
      ] as Array<Record<string, any>>,
      movements: [] as Array<Record<string, any>>,
    };
    const matches = (row: Record<string, any>, where: Record<string, any>) =>
      Object.entries(where).every(([key, value]) => row[key] === value);
    const tx = {
      fbsTsdAssembly: { findUnique: vi.fn(async () => current) },
      clientRequest: { findUnique: vi.fn(async () => ({ warehouseId: 'warehouse-1' })) },
      stockMovement: {
        findMany: vi.fn(async () => state.movements.filter(m => m.status === 'PACKING')),
        create: vi.fn(async ({ data }: any) => { state.movements.push(data); return data; }),
      },
      box: { findUnique: vi.fn(async () => ({ id: task.boxId, code: current.boxCode, warehouseId: 'warehouse-1', palletId: null })) },
      stockBalance: {
        findMany: vi.fn(async () => state.available > 0 ? [{ id: 'balance-1', quantity: state.available,
          warehouseId: 'warehouse-1', boxId: task.boxId, palletId: null }] : []),
        update: vi.fn(async ({ data }: any) => { state.available -= data.quantity.decrement; }),
        delete: vi.fn(async () => { state.available = 0; }),
        upsert: vi.fn(async ({ update }: any) => { state.packing += update.quantity.increment; }),
      },
      productMark: {
        findFirst: vi.fn(async ({ where }: any) => state.marks.find(m => matches(m, where)) ?? null),
        updateMany: vi.fn(async ({ where, data }: any) => {
          if (options.loseMark) return { count: 0 };
          const rows = state.marks.filter(m => matches(m, where));
          rows.forEach(m => Object.assign(m, data));
          return { count: rows.length };
        }),
      },
    };
    const prisma = { $transaction: async (fn: (t: typeof tx) => Promise<void>) => {
      const before = structuredClone(state);
      try { await fn(tx); } catch (error) { state = before; throw error; }
    } };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    Object.assign(service, { boxCodes: { getPolicy: async () => ({ storageBoxPrefix: 'SBOX_', storageBoxAliases: ['FFL_LKBBOX'] }), normalize: async (code: string) => code } });
    return { tx, state: () => structuredClone(state), pick: () => (service as any).reserveAcceptedWildberriesStock(current) };
  }

  it.each([{ missing: true }, { wrongBox: true }])('rejects a missing or foreign-box KIZ without consuming another unit: %j', async options => {
    const f = fixture(options), before = f.state();
    await expect(f.pick()).rejects.toThrow('КИЗ не найден в доступном остатке выбранного короба');
    expect(f.state()).toEqual(before);
    expect(f.tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('moves only the scanned KIZ and one unit to packing; retry does not consume again', async () => {
    const f = fixture();
    await f.pick();
    expect(f.state()).toMatchObject({ available: 1, packing: 1, marks: [
      { value: task.kiz, boxId: null, status: 'PACKING' },
      { value: 'other-physical-kiz', boxId: task.boxId, status: 'AVAILABLE' },
    ] });
    expect(f.tx.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ value: task.kiz, boxId: task.boxId, status: 'AVAILABLE' }),
    }));
    const picked = f.state();
    await f.pick();
    expect(f.state()).toEqual(picked);
  });

  it('does not invent packed stock for a KIZ whose source has zero balance', async () => {
    const f = fixture({ quantity: 0 }), before = f.state();
    await expect(f.pick()).rejects.toThrow('Недостаточно доступного остатка');
    expect(f.state()).toEqual(before);
    expect(f.tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('rolls back balance and movements when the exact KIZ update no longer matches', async () => {
    const f = fixture({ loseMark: true }), before = f.state();
    await expect(f.pick()).rejects.toThrow('КИЗ изменился во время списания');
    expect(f.state()).toEqual(before);
  });
});

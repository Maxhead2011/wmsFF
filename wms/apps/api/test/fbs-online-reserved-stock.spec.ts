import { afterEach, describe, expect, it, vi } from 'vitest';
import { TsdAssemblyService } from '../src/modules/tsd/tsd-assembly.service';

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED', 'true');
  vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED', '');
  const task = { id: 'new-attempt', orderId: '5703858074', connectionId: 'wb', requestItemId: 'item',
    skuId: 'target', sourceSkuId: null, reservedBoxId: 'new-box', reservedBoxCode: 'FFL_LKB0109_63',
    boxId: null, boxCode: null, status: 'RESERVED', itemCount: 1, deviceCode: 'AUTO',
    updatedAt: new Date(), completedAt: null, productName: 'Костюм', barcode: null, kiz: null };
  const balance = { boxId: 'new-box', skuId: 'target', quantity: 10, box: {
    id: 'new-box', code: 'FFL_LKB0109_63', storagePlacement: { palletId: 'pallet-84', pallet: {
      code: 'PALET_SORT_84', zoneId: 'zone', zone: { code: 'Z', name: 'Помещение' } } } } };
  const db = {
    clientRequest: { findUnique: vi.fn().mockResolvedValue({ clientId: 'lukin', warehouseId: 'moscow' }) },
    fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([task]) },
    fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue([{ orderId: task.orderId, connectionId: 'wb',
      lastSkuId: 'target', lastItemCount: 1, lastSupplierStatus: 'complete', lastWbStatus: 'waiting' }]) },
    fbsAssemblyAttemptHistory: { findMany: vi.fn().mockResolvedValue([]) },
    fbsReshipmentRun: { findMany: vi.fn().mockResolvedValue([]) },
    stockBalance: { findMany: vi.fn().mockResolvedValue([balance]) },
    storagePalletBox: { findMany: vi.fn().mockResolvedValue([]) },
    sku: { findMany: vi.fn().mockResolvedValue([]) }, auditLog: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const rows = [{ itemId: 'item', skuId: 'target', name: 'Костюм', requestedQuantity: 1,
    allocations: [{ boxCode: 'FFL_LKB1807_228', quantity: 1 }] }];
  const service = new TsdAssemblyService(db as never, {} as never, {} as never, {} as never, {} as never) as any;
  return { db, task, balance, rows, read: async () => (await service.loadFbsAssemblyFacts('request-957', rows)).notCollected.rows };
}

describe('current reserved stock in FBS online execution', () => {
  // TEST: order 5703858074 has a live reserve in box 63; the historical box 228 is empty.
  it.each([true, false])('shows the current reserved box with historical allocations present: %s', async historical => {
    const f = fixture(); if (!historical) f.rows[0].allocations = [];
    const rows = await f.read();
    expect(rows[0].availableBoxes).toEqual([expect.objectContaining({ boxCode: 'FFL_LKB0109_63', quantity: 1,
      palletCode: 'PALET_SORT_84', storageLocation: expect.objectContaining({ zoneName: 'Помещение' }) })]);
    expect(f.db.fbsTsdAssembly.findMany.mock.calls[0][0].select).toMatchObject({ reservedBoxId: true, sourceSkuId: true });
    expect(f.db.stockBalance.findMany.mock.calls[0][0].where).toMatchObject({ clientId: 'lukin', warehouseId: 'moscow',
      status: 'AVAILABLE', boxId: { in: ['new-box'] }, skuId: { in: ['target'] },
      box: { clientId: 'lukin', warehouseId: 'moscow', status: { notIn: ['deleted', 'archived', 'shipped'] } } });
  });

  // TEST: empty/invalid reserves cannot resurrect a historical source.
  it.each([0, -1])('hides reserved stock with quantity %s', async quantity => {
    const f = fixture(); f.balance.quantity = quantity;
    expect((await f.read())[0].availableBoxes).toEqual([]);
  });
  it('does not use a balance of another SKU', async () => {
    const f = fixture(); f.balance.skuId = 'other';
    expect((await f.read())[0].availableBoxes).toEqual([]);
  });
  it('uses the physical source SKU for relabeling', async () => {
    const f = fixture(); Object.assign(f.task, { sourceSkuId: 'source' }); f.balance.skuId = 'source';
    expect((await f.read())[0].availableBoxes[0]).toMatchObject({ boxCode: 'FFL_LKB0109_63', quantity: 1 });
    expect(f.db.stockBalance.findMany.mock.calls[0][0].where.skuId).toEqual({ in: ['source'] });
  });
  it('keeps the sold installation behavior when both release flags are off', async () => {
    const f = fixture(); vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED', 'false');
    expect((await f.read())[0].availableBoxes[0].boxCode).toBe('FFL_LKB1807_228');
    expect(f.db.stockBalance.findMany).not.toHaveBeenCalled();
  });
  it('does not display stock twice for two pending orders sharing one physical unit', async () => {
    const f = fixture(); f.balance.quantity = 1;
    f.db.fbsTsdAssembly.findMany.mockResolvedValue([f.task, { ...f.task, id: 'second', orderId: '5703858075' }]);
    f.db.fbsOrderRequestLink.findMany.mockResolvedValue([
      { orderId: f.task.orderId, connectionId: 'wb', lastSkuId: 'target' },
      { orderId: '5703858075', connectionId: 'wb', lastSkuId: 'target' },
    ]);
    f.rows[0].requestedQuantity = 2;
    expect((await f.read())[0].availableBoxes).toEqual([expect.objectContaining({ quantity: 1 })]);
  });
});

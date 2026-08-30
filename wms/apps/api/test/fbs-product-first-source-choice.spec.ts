import { MarketplaceType, StockStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

const worker = {
  id: 'worker-1',
  name: 'Сборщик',
  deviceCode: 'TSD-1',
};

describe('FBS product-first source selection', () => {
  // TEST: after the product barcode is accepted, the physical source box can be attached.
  it('claims the physical box after the product was scanned first', async () => {
    const updatedAt = new Date('2026-08-30T10:00:00.000Z');
    const task = {
      id: 'task-product-first',
      clientId: 'client-1',
      requestId: 'request-1',
      skuId: 'sku-1',
      sourceSkuId: null,
      status: 'IN_PROGRESS',
      itemCount: 1,
      relabelRequired: false,
      reservedAt: null,
      reservedBoxId: null,
      boxId: null,
      boxCode: null,
      sourceBarcode: null,
      barcode: '4600000000012',
      kiz: null,
      relabelConfirmedAt: null,
      workerUserId: worker.id,
      deviceCode: worker.deviceCode,
      updatedAt,
    };
    const claimed = {
      ...task,
      reservedBoxId: 'box-1',
      reservedBoxCode: 'FFL_BOX_1',
      boxId: 'box-1',
      boxCode: 'FFL_BOX_1',
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{
        status: 'active',
        clientId: task.clientId,
        warehouseId: 'warehouse-1',
      }]),
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          clientId: task.clientId,
          warehouseId: 'warehouse-1',
        }),
      },
      stockBalance: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 1 } }),
      },
      fbsTsdAssembly: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(task)
          .mockResolvedValueOnce(task)
          .mockResolvedValueOnce(claimed),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new MarketplaceConnectionsService({
      $transaction: vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx)),
    } as never, {} as never);
    vi.spyOn(service as any, 'fbsTsdReservationRowsBySku')
      .mockResolvedValue(new Map([['sku-1', []]]));

    await expect(
      (service as any).claimFbsTsdBoxAtomically(
        task,
        { id: 'box-1', code: 'FFL_BOX_1', warehouseId: 'warehouse-1' },
        'warehouse-1',
        worker,
      ),
    ).resolves.toMatchObject({
      id: task.id,
      barcode: task.barcode,
      boxId: 'box-1',
      boxCode: 'FFL_BOX_1',
    });
  });

  // TEST: "Без короба" is allowed only after a product barcode was accepted.
  it('marks the source as pending after the product was scanned', async () => {
    const task = {
      id: 'task-no-box',
      clientId: 'client-1',
      requestId: 'request-1',
      status: 'IN_PROGRESS',
      barcode: '4600000000012',
      sourceBarcode: null,
      boxId: null,
      boxCode: null,
      kiz: null,
      relabelConfirmedAt: null,
    };
    const updated = {
      ...task,
      boxCode: 'БЕЗ КОРОБА',
      sourceBoxPending: true,
    };
    const service = new MarketplaceConnectionsService({} as never, {} as never);
    vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);
    vi.spyOn(service as any, 'updateFbsTsdUnderLease').mockResolvedValue(updated);
    vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(
      async (current: unknown, _user: unknown, message: string) => ({ task: current, message }),
    );

    await expect(
      service.scanFbsTsdBox(task.id, { boxCode: 'БЕЗ КОРОБА' }, worker as never),
    ).resolves.toMatchObject({
      task: {
        boxId: null,
        boxCode: 'БЕЗ КОРОБА',
        sourceBoxPending: true,
      },
      message: expect.stringContaining('при закрытии заявки'),
    });
  });

  // TEST: the deferred source must not create a PACKING balance or reduce random stock.
  it('does not reserve stock before a pending source is resolved', async () => {
    const stockMovementFindMany = vi.fn().mockResolvedValue([]);
    const stockMovementCreate = vi.fn().mockResolvedValue({ id: 'movement-1' });
    const stockBalanceFindMany = vi.fn().mockResolvedValue([]);
    const stockBalanceUpsert = vi.fn().mockResolvedValue({});
    const productMarkUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const tx = {
      stockMovement: {
        findMany: stockMovementFindMany,
        create: stockMovementCreate,
      },
      box: { findUnique: vi.fn() },
      stockBalance: {
        findMany: stockBalanceFindMany,
        upsert: stockBalanceUpsert,
      },
      productMark: { updateMany: productMarkUpdateMany },
    };
    const service = new MarketplaceConnectionsService({} as never, {} as never);

    await (service as any).reserveCompletedWildberriesStock(
      tx,
      {
        id: 'task-no-box',
        marketplace: MarketplaceType.WILDBERRIES,
        completedAt: null,
        sourceBoxPending: true,
        itemCount: 1,
        clientId: 'client-1',
        skuId: 'sku-1',
        boxId: null,
        boxCode: 'БЕЗ КОРОБА',
        requestId: 'request-1',
        orderId: '5600000001',
        kiz: '010460000000000021TEST',
        wbMetaStatus: 'ACCEPTED',
        status: 'IN_PROGRESS',
      },
      'warehouse-1',
    );

    expect(stockMovementFindMany).not.toHaveBeenCalled();
    expect(stockMovementCreate).not.toHaveBeenCalled();
    expect(stockBalanceFindMany).not.toHaveBeenCalled();
    expect(stockBalanceUpsert).not.toHaveBeenCalled();
    expect(productMarkUpdateMany).not.toHaveBeenCalled();
  });
});

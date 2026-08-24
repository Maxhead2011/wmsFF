import { describe, expect, it, vi } from 'vitest';
import { ArchivedEmptyBoxPalletDetachService } from '../src/common/boxes/archived-empty-box-pallet-detach.service';

type TestOptions = {
  boxStatus?: string;
  balanceCount?: number;
  balanceSum?: number | null;
  placementDeleteCounts?: number[];
  aggregateError?: Error;
};

function testContext(options: TestOptions = {}) {
  const boxDelete = vi.fn();
  const movementDeleteMany = vi.fn();
  const markDeleteMany = vi.fn();
  const placementDeleteMany = vi.fn();
  for (const count of options.placementDeleteCounts ?? [1]) {
    placementDeleteMany.mockResolvedValueOnce({ count });
  }

  const aggregate = options.aggregateError
    ? vi.fn().mockRejectedValue(options.aggregateError)
    : vi.fn().mockResolvedValue({
        _count: { _all: options.balanceCount ?? 0 },
        _sum: { quantity: options.balanceSum ?? null },
      });

  const tx = {
    box: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'box-1',
        code: 'FFL_SOURCE',
        clientId: 'client-1',
        warehouseId: 'warehouse-1',
        status: options.boxStatus ?? 'archived',
        storagePlacement: {
          id: 'placement-1',
          palletId: 'storage-pallet-1',
          boxCode: 'FFL_SOURCE',
        },
      }),
      delete: boxDelete,
    },
    stockBalance: { aggregate },
    storagePalletBox: { deleteMany: placementDeleteMany },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    stockMovement: { deleteMany: movementDeleteMany },
    productMark: { deleteMany: markDeleteMany },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const service = new ArchivedEmptyBoxPalletDetachService(prisma as never);

  return {
    service,
    prisma,
    tx,
    historyDeletes: { boxDelete, movementDeleteMany, markDeleteMany },
  };
}

describe('ArchivedEmptyBoxPalletDetachService', () => {
  // TEST: only the conjunction "archived AND factual quantity = 0" may detach a box.
  it('detaches an archived box with no balance rows and writes the required audit event', async () => {
    const context = testContext({ balanceCount: 0, balanceSum: null });

    const result = await context.service.detachIfArchivedAndEmpty({
      boxId: 'box-1',
      userId: 'admin-1',
      reason: 'whole-box-transfer',
    });

    expect(result).toMatchObject({
      detached: true,
      boxId: 'box-1',
      palletId: 'storage-pallet-1',
      quantity: 0,
    });
    expect(context.prisma.$transaction).toHaveBeenCalledOnce();
    expect(context.tx.stockBalance.aggregate).toHaveBeenCalledWith({
      where: { boxId: 'box-1', quantity: { gt: 0 } },
      _count: { _all: true },
      _sum: { quantity: true },
    });
    expect(context.tx.storagePalletBox.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'placement-1',
        boxId: 'box-1',
        box: {
          status: 'archived',
          balances: { none: { quantity: { gt: 0 } } },
        },
      },
    });
    expect(context.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'admin-1',
        action: 'EMPTY_ARCHIVED_BOX_AUTO_DETACHED',
        entity: 'Box',
        entityId: 'box-1',
        payload: expect.objectContaining({
          message: 'Пустой архивный короб автоматически удалён с паллетсорта',
          boxCode: 'FFL_SOURCE',
          palletId: 'storage-pallet-1',
          reason: 'whole-box-transfer',
        }),
      }),
    });
  });

  // TEST: zero stock alone must never detach an active box.
  it('keeps an active box attached even when its factual quantity is zero', async () => {
    const context = testContext({ boxStatus: 'active', balanceCount: 0, balanceSum: null });

    const result = await context.service.detachIfArchivedAndEmpty({ boxId: 'box-1' });

    expect(result).toMatchObject({ detached: false, boxId: 'box-1' });
    expect(context.tx.storagePalletBox.deleteMany).not.toHaveBeenCalled();
    expect(context.tx.auditLog.create).not.toHaveBeenCalled();
  });

  // TEST: archive status alone must never detach a box that still has stock.
  it('keeps an archived box attached when its factual quantity is positive', async () => {
    const context = testContext({ balanceCount: 2, balanceSum: 3 });

    const result = await context.service.detachIfArchivedAndEmpty({ boxId: 'box-1' });

    expect(result).toMatchObject({ detached: false, boxId: 'box-1', quantity: 3 });
    expect(context.tx.storagePalletBox.deleteMany).not.toHaveBeenCalled();
    expect(context.tx.auditLog.create).not.toHaveBeenCalled();
  });

  // TEST: anomalous negative rows cannot cancel a positive factual balance because only positive rows are canonical.
  it('queries only positive balance rows when deciding whether the box is empty', async () => {
    const context = testContext({ balanceCount: 1, balanceSum: 6 });

    await context.service.detachIfArchivedAndEmpty({ boxId: 'box-1' });

    expect(context.tx.stockBalance.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { boxId: 'box-1', quantity: { gt: 0 } },
    }));
    expect(context.tx.storagePalletBox.deleteMany).not.toHaveBeenCalled();
  });

  // TEST: deleting an already absent relation is a successful no-op and cannot duplicate audit history.
  it('is idempotent and writes no duplicate audit when the placement was already removed', async () => {
    const context = testContext({
      balanceCount: 0,
      balanceSum: null,
      placementDeleteCounts: [1, 0],
    });

    await context.service.detachIfArchivedAndEmpty({ boxId: 'box-1', userId: 'admin-1' });
    const repeated = await context.service.detachIfArchivedAndEmpty({ boxId: 'box-1', userId: 'admin-1' });

    expect(repeated).toMatchObject({ detached: false, boxId: 'box-1', quantity: 0 });
    expect(context.tx.storagePalletBox.deleteMany).toHaveBeenCalledTimes(2);
    expect(context.tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  // TEST: a database failure is not converted into a false zero balance.
  it('propagates a factual-quantity query error and does not detach the box', async () => {
    const context = testContext({ aggregateError: new Error('stock balance unavailable') });

    await expect(
      context.service.detachIfArchivedAndEmpty({ boxId: 'box-1' }),
    ).rejects.toThrow('stock balance unavailable');
    expect(context.tx.storagePalletBox.deleteMany).not.toHaveBeenCalled();
    expect(context.tx.auditLog.create).not.toHaveBeenCalled();
  });

  // TEST: SQL SUM=NULL is valid zero only for an actually empty aggregate set.
  it('does not treat a null sum with existing balance rows as zero', async () => {
    const context = testContext({ balanceCount: 1, balanceSum: null });

    await expect(
      context.service.detachIfArchivedAndEmpty({ boxId: 'box-1' }),
    ).rejects.toThrow(/quantity|остат/i);
    expect(context.tx.storagePalletBox.deleteMany).not.toHaveBeenCalled();
    expect(context.tx.auditLog.create).not.toHaveBeenCalled();
  });

  // TEST: only the active pallet relation is removed; box, movements and KIZ history remain intact.
  it('does not delete the box, stock movements or product marks', async () => {
    const context = testContext({ balanceCount: 0, balanceSum: null });

    await context.service.detachIfArchivedAndEmpty({ boxId: 'box-1' });

    expect(context.historyDeletes.boxDelete).not.toHaveBeenCalled();
    expect(context.historyDeletes.movementDeleteMany).not.toHaveBeenCalled();
    expect(context.historyDeletes.markDeleteMany).not.toHaveBeenCalled();
  });

  // TEST: background dry-run must report eligibility without removing placement or writing audit.
  it('previews an archived empty candidate without changing data', async () => {
    const context = testContext({ balanceCount: 0, balanceSum: null });

    const result = await context.service.previewIfArchivedAndEmpty({ boxId: 'box-1' });

    expect(result).toMatchObject({
      eligible: true,
      boxId: 'box-1',
      palletId: 'storage-pallet-1',
      quantity: 0,
    });
    expect(context.tx.storagePalletBox.deleteMany).not.toHaveBeenCalled();
    expect(context.tx.auditLog.create).not.toHaveBeenCalled();
  });
});

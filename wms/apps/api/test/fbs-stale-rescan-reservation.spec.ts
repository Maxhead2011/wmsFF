import { describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: request 653's available unit must not be reserved by a rescan from closed request 147.
function fixture(requestStatus = 'DONE', shipped = true, taskStatus = 'RESCAN_REQUIRED') {
  const task = { id: 'old-task', requestId: 'request-147', connectionId: 'wb-1', orderId: 'old-order',
    skuId: 'sku-1', sourceSkuId: null, status: taskStatus, boxId: 'box-212', reservedBoxId: 'box-212',
    itemCount: 1, sourceBarcode: null, barcode: null, kiz: null, relabelConfirmedAt: null,
    completedAt: new Date('2026-08-06'), deviceCode: 'old-device' };
  const db = {
    fbsTsdAssembly: { findMany: vi.fn(async () => [task]), updateMany: vi.fn() },
    clientRequest: { findMany: vi.fn(async ({ where }: any) =>
      where.status.notIn.includes(requestStatus) ? [] : [{ id: task.requestId }]) },
    fbsOrderRequestLink: { findMany: vi.fn(async () => shipped
      ? [{ connectionId: task.connectionId, orderId: task.orderId }] : []) },
    stockMovement: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), create: vi.fn() },
    client: { findUnique: vi.fn(async () => ({ storesWithoutBoxes: false, relabelingEnabled: true })) },
    sku: { findUnique: vi.fn(async () => ({ id: 'sku-1', article: 'polo', size: 'M' })), findMany: vi.fn(async () => []) },
    clientArticleMapping: { findMany: vi.fn(async () => [{ sourceArticle: 'polo', targetArticle: 'polo' }]) },
  };
  const service = new MarketplaceConnectionsService(db as never, {} as never) as any;
  const input = { clientId: 'client-1', skuId: 'sku-1', skuIds: ['sku-1'], excludeTaskId: 'new-task' };
  return { service, db, task, input };
}

describe('stale FBS rescan reservations', () => {
  for (const mode of ['single', 'bulk'] as const) {
    const rows = async (f: ReturnType<typeof fixture>) => mode === 'single'
      ? f.service.fbsTsdReservationRows(f.input)
      : (await f.service.fbsTsdReservationRowsBySku(f.input)).get('sku-1');

    it.each(['DONE', 'CANCELLED', 'REJECTED'])(`${mode}: ignores a rescan from %s request`, async status => {
      const f = fixture(status, false);
      expect(await rows(f)).toEqual([]);
      expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
      expect(f.db.stockMovement.create).not.toHaveBeenCalled();
    });

    it(`${mode}: ignores a shipped rescan even while the request is open`, async () => {
      expect(await rows(fixture('SUBMITTED', true))).toEqual([]);
    });

    it(`${mode}: preserves an active rescan reservation`, async () => {
      expect(await rows(fixture('SUBMITTED', false))).toEqual([
        expect.objectContaining({ boxId: 'box-212', itemCount: 1 }),
      ]);
    });

    it(`${mode}: does not release on another order's shipped status`, async () => {
      const f = fixture('SUBMITTED', true);
      f.db.fbsOrderRequestLink.findMany.mockResolvedValue([{ connectionId: 'wb-other', orderId: 'old-order' }]);
      expect(await rows(f)).toHaveLength(1);
    });

    it(`${mode}: preserves return-required work despite a closed request`, async () => {
      expect(await rows(fixture('DONE', true, 'RETURN_REQUIRED'))).toHaveLength(1);
    });

    it(`${mode}: preserves physically started work rather than silently releasing it`, async () => {
      const f = fixture('DONE', true, 'IN_PROGRESS'); f.task.barcode = '2044510044992' as any;
      expect(await rows(f)).toHaveLength(1);
    });
  }

  it('returns the available box for the new order without old rescan subtraction', async () => {
    const f = fixture();
    const boxes = [{ code: 'FFL_LKB2504_212', quantity: 1, status: 'AVAILABLE' }];
    const source = await f.service.resolveFbsTsdStockSource('client-1', { id: 'sku-1', article: 'polo' }, boxes, 'new-task');
    expect(source).toMatchObject({ storageBoxes: boxes, relabelRequired: false });
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  });
});

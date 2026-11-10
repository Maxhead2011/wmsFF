import { describe, it, expect, vi } from 'vitest';
import { wbLabelOrders } from './wb-label-orders';

// TEST: label reads must not refresh a client's inventory, billing or other marketplaces.
function setup() {
  const db: any = {
    clientMarketplaceConnection: { findMany: vi.fn(async () => [{ id: 'cab', apiKey: 'test', marketplace: 'WILDBERRIES' }]) },
    fbsOrderRequestLink: { findMany: vi.fn(async () => [{ connectionId: 'cab', orderId: '42', orderPlacedAt: new Date('2026-11-08T09:00:00Z') }]) },
    sku: { findMany: vi.fn(async () => [{ id: 'sku', article: 'fabric', barcodes: [{ value: '12345678' }] }]) },
    fbsSupplyPlan: { findMany: vi.fn(async () => [{ connectionId: 'cab', supplyId: 'supply', deliveryDestination: 'PICKUP_POINT' }]) },
  };
  const history = vi.fn(async (_headers: any, _selected: any) => [{ id: 42, skus: ['12345678'], article: 'fabric', supplyId: 'supply', requiredMeta: ['sgtin'], crossBorderType: 1 }]);
  const json = vi.fn(async () => ({ orders: [{ id: 42, supplierStatus: 'confirm', wbStatus: 'waiting' }] }));
  return { db, history, json };
}
describe('WB print-only selected read', () => {
  // TEST: WB nests the B2B flag in options; missing metadata must remain unknown.
  it.each([true, false, undefined])('preserves B2B=%s from raw WB options', async flag => {
    const x = setup();
    x.history.mockResolvedValue([{ id: 42, options: flag === undefined ? {} : { isB2B: flag } }] as any);
    const rows = await wbLabelOrders(x.db, 'client', [{ connectionId: 'cab', id: '42' }], x.history, x.json);
    expect(rows![0].isB2b).toBe(flag ?? null);
  });
  it('works after cold restart, reads only selected cabinet and fetches current statuses once', async () => {
    const x = setup();
    const rows = await wbLabelOrders(x.db, 'client', [{ connectionId: 'cab', id: '42' }], x.history, x.json);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ id: '42', product: { id: 'sku' }, requiredMeta: ['sgtin'], crossBorderType: '1', shipmentPlan: { requiresCargoPlaces: true } });
    expect(x.history).toHaveBeenCalledOnce(); expect(x.json).toHaveBeenCalledOnce();
    expect(x.history.mock.calls[0][1].selectedIds).toEqual(new Set(['42']));
    expect(x.db.clientMarketplaceConnection.findMany.mock.calls[0][0].where).toMatchObject({ clientId: 'client', isActive: true, id: { in: ['cab'] } });
  });
  it('fails closed for a foreign cabinet before marketplace requests', async () => {
    const x = setup(); x.db.clientMarketplaceConnection.findMany.mockResolvedValue([]);
    await expect(wbLabelOrders(x.db, 'other', [{ connectionId: 'cab', id: '42' }], x.history, x.json)).rejects.toThrow('кабинета');
    expect(x.history).not.toHaveBeenCalled(); expect(x.json).not.toHaveBeenCalled();
  });
  it('does not trust historical status when WB cancelled an order', async () => {
    const x = setup(); x.json.mockResolvedValue({ orders: [{ id: 42, supplierStatus: 'cancel', wbStatus: 'canceled' }] });
    const rows = await wbLabelOrders(x.db, 'client', [{ connectionId: 'cab', id: '42' }], x.history, x.json);
    expect(rows![0].category).toBe('cancelled');
  });
  it('does not fabricate metadata from local stock links', async () => {
    const x = setup(); x.history.mockResolvedValue([]);
    await expect(wbLabelOrders(x.db, 'client', [{ connectionId: 'cab', id: '42' }], x.history, x.json)).rejects.toThrow('42');
  });
  it('keeps Ozon on its existing implementation', async () => {
    const x = setup(); x.db.clientMarketplaceConnection.findMany.mockResolvedValue([{ id: 'cab', marketplace: 'OZON' }]);
    expect(await wbLabelOrders(x.db, 'client', [{ connectionId: 'cab', id: '42' }], x.history, x.json)).toBeNull();
    expect(x.history).not.toHaveBeenCalled();
  });
});

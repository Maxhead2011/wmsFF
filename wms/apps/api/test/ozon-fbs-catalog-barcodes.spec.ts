import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService, fbsOrderRefreshFingerprint } from '../src/modules/marketplace-connections/marketplace-connections.service';

const connection = { id: 'ozon', marketplace: 'OZON', sellerId: 'seller', apiKey: 'test-key' };
const posting = (id: string, quantity: number) => ({ posting_number: id, status: 'awaiting_packaging',
  products: [{ offer_id: '668803100', sku: 5639922714, quantity }] });
const card = { id: 6157894687, offer_id: '668803100', barcodes: ['2047587291443'], sources: [{ sku: 5639922714 }] };
function setup(items: unknown[] = [card], postings = [posting('0136772763-0314-1', 2), posting('0136772763-0317-1', 1)], failed = false) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const catalog = url.endsWith('/v3/product/info/list');
    return { ok: !(catalog && failed), status: catalog && failed ? 403 : 200,
      json: async () => catalog ? { items } : { postings, has_next: false } };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { service: new MarketplaceConnectionsService({} as never, {} as never) as any, fetchMock };
}
beforeEach(() => vi.stubEnv('WMS_OZON_FBS_CATALOG_BARCODES', 'true'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('Ozon FBS catalog barcode matching', () => {
  it('reprocesses recovered barcodes without requiring an Ozon status change', () => {
    // TEST: cached summaries use barcodes; raw Ozon rows use skus. Equivalent values share a fingerprint.
    const order = { marketplace: 'OZON', supplierStatus: 'awaiting_packaging' };
    expect(fbsOrderRefreshFingerprint({ ...order, barcodes: ['668803100'] }))
      .not.toBe(fbsOrderRefreshFingerprint({ ...order, skus: ['668803100', '2047587291443'] }));
    expect(fbsOrderRefreshFingerprint({ ...order, barcodes: ['2047587291443', '668803100'] }))
      .toBe(fbsOrderRefreshFingerprint({ ...order, skus: ['668803100', '2047587291443'] }));
    vi.stubEnv('WMS_OZON_FBS_CATALOG_BARCODES', 'false');
    expect(fbsOrderRefreshFingerprint({ ...order, barcodes: [] }))
      .toBe(fbsOrderRefreshFingerprint({ ...order, skus: ['2047587291443'] }));
  });
  it('resolves both ADP200 postings by the physical barcode with one deduplicated catalog read', async () => {
    // TEST: posting offer 668803100 differs from WMS article ToolkitRC ADP200; their physical barcode is identical.
    const { service, fetchMock } = setup(); const orders = await service.fetchOzonFbsOrders(connection);
    expect(orders.map((o: any) => o.skus)).toEqual([['2047587291443', '668803100'], ['2047587291443', '668803100']]);
    expect(orders.map((o: any) => o.itemCount)).toEqual([2, 1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ sku: ['5639922714'] });
  });
  it('does not attach a barcode from a different Ozon SKU or offer', async () => {
    // TEST: equal product IDs, names or a reused offer alone cannot establish physical identity.
    const { service } = setup([{ ...card, sources: [{ sku: 999 }] }, { ...card, offer_id: 'other' }]);
    expect((await service.fetchOzonFbsOrders(connection))[0].skus).toEqual(['668803100']);
  });
  it('keeps sold installations opted out by default', async () => {
    // TEST: no extra remote calls or mapping changes when the flag is absent.
    vi.stubEnv('WMS_OZON_FBS_CATALOG_BARCODES', ''); const { service, fetchMock } = setup();
    expect((await service.fetchOzonFbsOrders(connection))[0].skus).toEqual(['668803100']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('retains orders if catalog access is unavailable', async () => {
    // TEST: a catalog permission failure must not hide orders already returned by Ozon.
    const { service } = setup([], undefined, true);
    expect(await service.fetchOzonFbsOrders(connection)).toHaveLength(2);
  });
  it('keeps posting barcodes without extra catalog reads', async () => {
    // TEST: already identified products need no enrichment.
    const p = posting('ready', 1); Object.assign(p.products[0], { barcodes: ['2047587291443'] });
    const { service, fetchMock } = setup([], [p]);
    expect((await service.fetchOzonFbsOrders(connection))[0].skus).toContain('2047587291443');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

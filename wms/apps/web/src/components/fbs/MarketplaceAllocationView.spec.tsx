import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewMarketplaceAllocation, saveMarketplaceAllocation, fetchMarketplaceAllocation } from '../../lib/api';
import { allocationProductChoices, suggestAllocationPairs } from './MarketplaceAllocationBindings';

afterEach(() => vi.unstubAllGlobals());
describe('Marketplace allocation UI API contract', () => {
  // TEST: WB offerId may be a barcode; the seller article must remain searchable separately.
  it('finds a WB card by its seller article independently of offerId', () => {
    const rows = [{ productId: '10:20', offerId: '001', article: 'KOREA-BLUE', name: 'Товар', size: 'M', color: '', barcodes: ['001'] }];
    expect(allocationProductChoices(rows, 'korea-blue', '')).toEqual(rows);
  });
  // TEST: exact matches remain suggestions; ambiguity and different leading zeroes require manual selection.
  it('never confirms or guesses a card from names or ambiguous barcodes', () => {
    const product = (id: string, barcode: string) => ({ productId: id, offerId: id, name: 'Одинаковое название', size: 'M', color: '', barcodes: [barcode] });
    expect(suggestAllocationPairs('001', [product('w', '001')], [product('o', '001')])).toMatchObject({ unique: true, confirmed: false });
    expect(suggestAllocationPairs('001', [product('w', '001'), product('w2', '001')], [product('o', '001')]).unique).toBe(false);
    expect(suggestAllocationPairs('001', [product('w', '1')], [product('o', '001')]).wb).toEqual([]);
  });

  // TEST: a suggested card beyond the first 100 must remain visible before the user confirms it.
  it('keeps a selected card visible even outside the search page', () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ productId: `${i}`, offerId: `${i}`, name: 'Товар', size: 'M', color: '', barcodes: [`00${i}`] }));
    const options = allocationProductChoices(rows, '', '149');
    expect(options).toHaveLength(100);
    expect(options[0].productId).toBe('149');
    expect(allocationProductChoices(rows, 'нет совпадений', '149').map(p => p.productId)).toEqual(['149']);
  });
  // TEST: preparing allocations must never call the legacy immediate WB sync endpoint.
  it('sends revision, selected client and preview pagination to separate endpoints', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('fetch', fetch);
    const draft = { wbConnectionId: 'w', ozonConnectionId: 'o', wbPercent: 70 };
    await saveMarketplaceAllocation('token', 'client', draft, 'revision');
    await previewMarketplaceAllocation('token', 'client', draft, '001', 2);
    expect(fetch.mock.calls[0][0]).toContain('/marketplace-connections/allocation/client');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ draft, revision: 'revision' });
    expect(fetch.mock.calls[1][0]).toContain('/allocation/client/preview');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ draft, search: '001', page: 2 });
    expect(fetch.mock.calls.some(([url]) => url.includes('/sync'))).toBe(false);
  });
  // TEST: reading the tile state is a single lightweight settings request, not a stock preview.
  it('returns single-cabinet state unchanged and safely encodes the client', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: false, message: 'Подключён только 1 кабинет' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const result = await fetchMarketplaceAllocation('token', 'client/other');
    expect(fetch.mock.calls[0][0]).toContain('client%2Fother');
    expect(fetch).toHaveBeenCalledOnce();
    expect(result.message).toBe('Подключён только 1 кабинет');
  });
});

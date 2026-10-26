import { describe, expect, it, vi } from 'vitest';
import { MultishopStockTransport, ShopDestination } from '../src/modules/marketplace-connections/multishop-stock-transport';
const account = { id: 'shop', marketplace: 'OZON', apiKey: 'fixture', sellerId: 'fixture' };
const target: ShopDestination = { connectionId: 'shop', marketplace: 'OZON', warehouseId: '123', productId: '11', offerId: 'offer' };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
describe('multishop provider transport', () => {
  // TEST: all pages are required before any stock increase can be calculated.
  it('reads complete v4 pending postings including later pages', async () => {
    const http = vi.fn().mockResolvedValueOnce(response({ postings: [{ posting_number: 'a' }], has_next: true, cursor: 'next' })).mockResolvedValueOnce(response({ postings: [{ posting_number: 'b' }], has_next: false, cursor: '' }));
    expect(await new MultishopStockTransport(http).ozonPending(account)).toHaveLength(2);
    expect(JSON.parse(http.mock.calls[1][1].body).cursor).toBe('next');
  });
  it('fails on a missing/repeated cursor instead of accepting a partial list', async () => {
    const http = vi.fn().mockImplementation(async () => response({ postings: [], has_next: true, cursor: 'repeat' }));
    await expect(new MultishopStockTransport(http).ozonPending(account)).rejects.toThrow('курсор');
  });
  it('reads free_stock rather than present and filters exact warehouse', async () => {
    const http = vi.fn(async () => response({ products: [{ warehouse_id: 123, product_id: 11, offer_id: 'offer', free_stock: 9, present: 10, reserved: 1 }], has_next: false }));
    expect(await new MultishopStockTransport(http).observe(account, target)).toBe(9);
  });
  it('never interprets an omitted warehouse as zero', async () => {
    expect(await new MultishopStockTransport(async () => response({ products: [], has_next: false })).observe(account, target)).toBeNull();
  });
  it('does not retry an unknown write', async () => {
    const http = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(new MultishopStockTransport(http).write(account, target, 9)).rejects.toThrow('timeout');
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('rejects per-product errors in an HTTP 200 response', async () => {
    await expect(new MultishopStockTransport(async () => response({ result: [{ updated: false, errors: [{ code: 'TOO_MANY_REQUESTS' }] }] })).write(account, target, 9)).rejects.toThrow('не подтвердил');
  });
});

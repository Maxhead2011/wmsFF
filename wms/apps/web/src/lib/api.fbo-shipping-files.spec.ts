import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFboShippingFiles } from './api';

// TEST: a document retry repeats only the existing read-only exports, never final packing.
describe('FBO shipping files', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('downloads both established WB files using authenticated GET requests', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => new Response(url.includes('wb-products') ? 'products' : 'packages'));
    vi.stubGlobal('fetch', fetch);
    const files = await downloadFboShippingFiles('token', 'request-1');
    expect(files.map(f => f.name)).toEqual(['wb-products-request-1.xlsx', 'wb-packages-request-1.xlsx']);
    expect(await Promise.all(files.map(f => f.blob.text()))).toEqual(['products', 'packages']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(c => String(c[0]).split('/client-requests/')[1])).toEqual([
      'request-1/marketplace/wb-products.xlsx', 'request-1/marketplace/wb-packages.xlsx',
    ]);
    for (const [,init] of fetch.mock.calls) {
      expect(init.method ?? 'GET').toBe('GET');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token');
    }
  });
  it('does not return a misleading partial pair when one export fails and allows a read-only retry', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => url.includes('wb-products')
      ? new Response('products') : new Response(JSON.stringify({ message: 'Export unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(downloadFboShippingFiles('token', 'request-1')).rejects.toThrow();
    fetch.mockImplementation(async () => new Response('ready'));
    expect(await downloadFboShippingFiles('token', 'request-1')).toHaveLength(2);
    expect(fetch.mock.calls.every(([,init]) => (init.method ?? 'GET') === 'GET')).toBe(true);
  });
});

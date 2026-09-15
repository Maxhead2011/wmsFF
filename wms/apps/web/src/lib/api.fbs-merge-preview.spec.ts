import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFbsInvoiceMergePreview } from './api';

// TEST: a normal period can exceed HTTP header limits; selection belongs in JSON, not the URL.
describe('FBS merge preview transport', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends 771 exact invoice IDs using one short POST request', async () => {
    const invoiceIds = Array.from({ length: 771 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ invoiceCount: 771 }) });
    vi.stubGlobal('fetch', fetch);
    expect(await fetchFbsInvoiceMergePreview('token', 'client', invoiceIds)).toEqual({ invoiceCount: 771 });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).not.toContain('?');
    expect(String(url).length).toBeLessThan(200);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ clientId: 'client', invoiceIds });
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves omitted versus explicitly empty selection', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetch);
    await fetchFbsInvoiceMergePreview('token', 'client');
    await fetchFbsInvoiceMergePreview('token', 'client', []);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ clientId: 'client' });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ clientId: 'client', invoiceIds: [] });
  });
});

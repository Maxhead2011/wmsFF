import { afterEach, describe, expect, it, vi } from 'vitest';
import { LamodaClient, openSecret, sealSecret } from '../src/modules/lamoda/lamoda-client';

const credentials = { oauthClientId: 'client', secret: 'very-secret', sellerId: 'seller' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const token = () => json({ access_token: 'token', expires_in: 3600, token_type: 'Bearer' }, 201);
const page = (key = 'nomenclatures', values: unknown[] = [], current = 1, total = 1) => json({ [key]: values, meta: { page: current, totalPages: total } });
afterEach(() => vi.unstubAllEnvs());

// TEST: contracts pin the actual Lamoda v2 envelopes, isolation and read-only transport.
describe('Lamoda adapter', () => {
  it('encrypts secrets with authenticated account binding and random IV', () => {
    vi.stubEnv('WMS_LAMODA_SECRET_KEY', Buffer.alloc(32, 7).toString('base64'));
    const value = sealSecret('password', 'account-1');
    expect(value).not.toContain('password');
    expect(sealSecret('password', 'account-1')).not.toBe(value);
    expect(openSecret(value, 'account-1')).toBe('password');
    expect(() => openSecret(value, 'account-2')).toThrow('SECRET_DECRYPTION_FAILED');
    vi.stubEnv('WMS_LAMODA_SECRET_KEY', '');
    expect(() => sealSecret('password', 'account-1')).toThrow('SECRET_KEY_NOT_CONFIGURED');
  });
  it('uses client_credentials and sellerId, reads every page', async () => {
    const http = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(page('nomenclatures', [{ sku: 'a' }], 1, 2)).mockResolvedValueOnce(page('nomenclatures', [{ sku: 'b' }], 2, 2));
    const rows = await new LamodaClient(http).collection(credentials, 'CATALOG');
    expect(rows.map(r => r.sku)).toEqual(['a', 'b']);
    expect(JSON.parse(http.mock.calls[0][1].body)).toEqual({ grant_type: 'client_credentials', client_id: 'client', client_secret: 'very-secret' });
    expect(http.mock.calls.slice(1).map(call => new URL(call[0]).searchParams.get('page'))).toEqual(['1', '2']);
    expect(http.mock.calls.slice(1).every(call => new URL(call[0]).searchParams.get('sellerId') === 'seller')).toBe(true);
    expect(http.mock.calls.slice(1).every(call => !call[1].method && !call[1].body && call[1].redirect === 'error')).toBe(true);
  });
  it.each([['ORDERS', 'orders'], ['FBO_SHIPMENTS', 'shipments'], ['FBS_SHIPMENTS', 'items'], ['RETURNS', 'data']] as const)('reads %s envelope %s', async (kind, key) => {
    const http = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(page(key, [{ id: 'x' }]));
    expect(await new LamodaClient(http).collection(credentials, kind)).toEqual([{ id: 'x' }]);
  });
  it('coalesces concurrent token requests but never shares across sellers', async () => {
    const http = vi.fn(async (url: string) => url.endsWith('auth-token') ? token() : page());
    const client = new LamodaClient(http);
    await Promise.all([client.check(credentials), client.check(credentials)]);
    expect(http.mock.calls.filter(([url]) => url.endsWith('auth-token'))).toHaveLength(1);
    await client.check({ ...credentials, sellerId: 'other' });
    expect(http.mock.calls.filter(([url]) => url.endsWith('auth-token'))).toHaveLength(2);
  });
  it('refreshes an expired token using its actual expires_in', async () => {
    let now = 0;
    const http = vi.fn(async (url: string) => url.endsWith('auth-token') ? json({ access_token: 't', expires_in: 10, token_type: 'Bearer' }) : page());
    const client = new LamodaClient(http, () => now);
    await client.check(credentials); now = 9500; await client.check(credentials);
    expect(http.mock.calls.filter(([url]) => url.endsWith('auth-token'))).toHaveLength(2);
  });
  it('refreshes once on 401, but never retries rate limits or server errors', async () => {
    const http = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(json({ secret: 'do-not-print' }, 401)).mockResolvedValueOnce(token()).mockResolvedValueOnce(page());
    await new LamodaClient(http).check(credentials); expect(http).toHaveBeenCalledTimes(4);
    const failing = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(json({ secret: 'do-not-print' }, 429));
    await expect(new LamodaClient(failing).check(credentials)).rejects.toThrow('HTTP_ERROR (429)');
    expect(failing).toHaveBeenCalledTimes(2);
  });
  it('rejects partial pages instead of representing them as an empty successful sync', async () => {
    const http = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(page('nomenclatures', [{ sku: 'a' }], 1, 2)).mockResolvedValueOnce(json({ error: 'secret' }, 503));
    await expect(new LamodaClient(http).collection(credentials, 'CATALOG')).rejects.toThrow('HTTP_ERROR (503)');
  });
  it('rejects broken pagination and a foreign-seller query override', async () => {
    const http = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(page('nomenclatures', [], 1, 2));
    await expect(new LamodaClient(http).collection(credentials, 'CATALOG', { sellerId: 'foreign' })).rejects.toThrow('INVALID_PAGE');
    expect(new URL(http.mock.calls[1][0]).searchParams.get('sellerId')).toBe('seller');
  });
  it('does not leak transport errors or remote response content', async () => {
    const http = vi.fn().mockRejectedValue(new Error('https://secret-url/password'));
    await expect(new LamodaClient(http).check(credentials)).rejects.toThrow('Lamoda: TRANSPORT_ERROR');
  });
});

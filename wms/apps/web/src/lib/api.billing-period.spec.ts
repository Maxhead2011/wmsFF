import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateBillingPeriod, previewBillingPeriod, type BillingPeriodInput } from './api';

const input: BillingPeriodInput = {
  clientId: 'client-1', periodFrom: '2026-08-01', periodTo: '2026-08-31',
  categories: ['FBS', 'PROCESSING', 'PRR', 'STORAGE'], excludeLukin: true,
};

describe('billing period API transport', () => {
  afterEach(() => vi.unstubAllGlobals());
  // TEST: exercise the real request helper; mocking the exported API function hides double JSON encoding.
  it.each(['preview', 'generate'] as const)('sends %s as a JSON object with unchanged filters and authentication', async action => {
    const result = action === 'preview' ? { previewHash: 'a'.repeat(64), groups: [] } : { invoices: [], replayed: false };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal('fetch', fetchMock);
    const body = action === 'preview' ? input : { ...input, previewHash: 'a'.repeat(64) };
    const response = action === 'preview'
      ? await previewBillingPeriod('test-token', input)
      : await generateBillingPeriod('test-token', { ...input, previewHash: 'a'.repeat(64) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(new RegExp(`/billing/invoices/period/${action}$`));
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-token');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual(body);
    expect(response).toEqual(result);
  });
});

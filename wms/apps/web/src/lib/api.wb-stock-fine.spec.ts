import { afterEach, expect, it, vi } from 'vitest';
import { checkFbsStockPublication, updateWbAnalysisSettings, updateWbSkuRule } from './api';
afterEach(() => vi.unstubAllGlobals());
// TEST: fine-settings forms must send versioned JSON objects without enabling stock control.
it('sends SKU exclusions, analysis step and read-only verification to separate endpoints', async () => {
  const calls: Array<{ url: string; body: any; method: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(options.body)), method: options.method! });
    return { ok: true, json: async () => ({}) };
  }));
  const body = { reserve: { mode: 'UNITS' as const, value: 6 }, blocked: true, expectedUpdatedAt: null };
  await updateWbSkuRule('test', 'client', 'sku', body);
  await updateWbAnalysisSettings('test', 'client', 7, 'version');
  await checkFbsStockPublication('test', 'client', 'connection');
  expect(calls.map(c => c.body)).toEqual([body, { maxShareChange: 7, expectedUpdatedAt: 'version' }, { clientId: 'client', connectionId: 'connection' }]);
  expect(calls.map(c => c.method)).toEqual(['PUT', 'PUT', 'POST']);
  expect(calls[0].url).toMatch(/\/client\/skus\/sku$/);
  expect(calls[2].url).toMatch(/\/allocation\/check$/);
  expect(calls.every(c => !('enabled' in c.body))).toBe(true);
});
// TEST: stale tabs keep an actionable conflict and never silently retry a settings write.
it('reports stale SKU settings without retrying or toggling publication', async () => {
  const fetch = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ message: 'Настройка уже изменена. Обновите раздел.' }) }));
  vi.stubGlobal('fetch', fetch);
  await expect(updateWbSkuRule('test', 'c', 's', { reserve: null, blocked: false, expectedUpdatedAt: null })).rejects.toThrow('уже изменена');
  expect(fetch).toHaveBeenCalledOnce();
});

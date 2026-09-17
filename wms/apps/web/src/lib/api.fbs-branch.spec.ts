import { afterEach, expect, it, vi } from 'vitest';
import { fetchFbsActiveClients, fetchFbsOrders } from './api';

afterEach(() => vi.unstubAllGlobals());

// TEST: orders and client counters must use the same view without changing the user's branch.
it('sends show-all only for the explicit all-branches view', async () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    urls.push(url);
    expect(init.method ?? 'GET').toBe('GET');
    return { ok: true, json: async () => ({}) };
  }));
  await fetchFbsOrders('token', 'client', false, true);
  await fetchFbsActiveClients('token', 'WILDBERRIES', true);
  await fetchFbsOrders('token', 'client');
  await fetchFbsActiveClients('token', 'WILDBERRIES');
  const queries = urls.map(url => new URL(url, 'https://example.test').searchParams);
  expect(queries.map(q => q.get('allBranches'))).toEqual(['1', '1', null, null]);
  expect(queries[0].get('clientId')).toBe('client');
  expect(queries[1].get('marketplace')).toBe('WILDBERRIES');
  expect(urls.every(url => !url.includes('/activate'))).toBe(true);
});

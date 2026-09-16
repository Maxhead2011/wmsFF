import { afterEach, expect, it, vi } from 'vitest';
import { fetchFbsOrders, fetchFbsActiveClients } from './api';
afterEach(() => vi.unstubAllGlobals());
// TEST: screen reads opt in; audit and existing action callers retain live semantics.
it('sends snapshot only for explicit display requests', async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL) => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal('fetch', fetcher);
  await fetchFbsOrders('test', 'client', true);
  await fetchFbsOrders('test', 'client', true, 'snapshot');
  await fetchFbsActiveClients('test', 'WILDBERRIES', 'snapshot');
  expect(String(fetcher.mock.calls[0][0])).not.toContain('view=');
  expect(String(fetcher.mock.calls[0][0])).toContain('refresh=1');
  expect(String(fetcher.mock.calls[1][0])).toContain('view=snapshot');
  expect(String(fetcher.mock.calls[2][0])).toContain('view=snapshot');
});

import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { sendWbRibbon } from './wbRibbonPrint';
afterEach(() => vi.unstubAllGlobals());
// TEST: a lost HTTP response must not enqueue another whole ribbon on retry.
it('reuses operation ID after network failure and generates a new one only after success', async () => {
  vi.stubGlobal('crypto', webcrypto); const values = new Map();
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => values.get(k), setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) });
  const fetch = vi.fn().mockRejectedValueOnce(Error('timeout')).mockResolvedValue({ ok: true, json: async () => ({ status: 'queued', pages: 5 }) }); vi.stubGlobal('fetch', fetch);
  await expect(sendWbRibbon('t', 'c', 's', 'PDF')).rejects.toThrow('timeout');
  await sendWbRibbon('t', 'c', 's', 'PDF'); await sendWbRibbon('t', 'c', 's', 'PDF');
  const bodies = fetch.mock.calls.map(c => JSON.parse(c[1].body));
  expect(bodies[0]).toEqual(bodies[1]); expect(bodies[2].requestId).not.toBe(bodies[1].requestId);
  expect(bodies[0]).toMatchObject({ clientId: 'c', stationId: 's', fileBase64: 'PDF' });
});

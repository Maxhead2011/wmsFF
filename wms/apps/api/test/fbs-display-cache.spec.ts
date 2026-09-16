import { afterEach, expect, it, vi } from 'vitest';
import { FbsDisplayCache } from '../src/modules/marketplace-connections/fbs-display-cache';
const tick = () => new Promise(resolve => setImmediate(resolve));
afterEach(() => vi.restoreAllMocks());

// TEST: a blocked marketplace must not spawn unbounded work or block another cabinet.
it('coalesces refresh clicks and runs at most two clients concurrently', async () => {
  const cache = new FbsDisplayCache<number>();
  let complete!: (value: number) => void;
  const first = vi.fn(() => new Promise<number>(resolve => { complete = resolve; }));
  const second = vi.fn(() => new Promise<number>(() => {}));
  const third = vi.fn(async () => 3);
  cache.refresh('a', first); cache.refresh('a', first, true);
  cache.refresh('b', second); cache.refresh('c', third);
  await tick();
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce(); expect(third).not.toHaveBeenCalled();
  complete(1); await tick();
  expect(cache.get('a')?.value).toBe(1); expect(third).toHaveBeenCalledOnce();
  cache.stop();
});

it('keeps stale data and safe errors, backing off even for forced retries', async () => {
  let now = 100_000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  const cache = new FbsDisplayCache<number>();
  cache.refresh('a', async () => 7); await tick();
  now += 61_000;
  const failure = vi.fn(async () => { throw new Error('WB HTTP 401 secret-token-here'); });
  cache.refresh('a', failure); await tick();
  expect(cache.get('a')).toMatchObject({ value: 7, pending: false });
  expect(cache.get('a')?.error).toContain('API-ключ');
  expect(cache.get('a')?.error).not.toContain('secret');
  cache.refresh('a', failure, true); await tick();
  expect(failure).toHaveBeenCalledOnce();
  now += 31_000; cache.refresh('a', async () => 9); await tick();
  expect(cache.get('a')).toMatchObject({ value: 9, error: null }); cache.stop();
});

it('stops queued work on shutdown and bounds the number of queued clients', async () => {
  const cache = new FbsDisplayCache<number>(); const load = vi.fn(async () => 1);
  for (let i = 0; i < 200; i++) cache.refresh(String(i), load);
  expect(cache.get('127')?.pending).toBe(true); expect(cache.get('128')).toBeUndefined();
  cache.stop(); await tick(); expect(load).not.toHaveBeenCalled();
});

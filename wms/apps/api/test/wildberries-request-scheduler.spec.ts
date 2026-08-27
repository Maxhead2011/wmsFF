import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runWithWildberriesRequestPriority,
  WildberriesRequestScheduler,
  wildberriesRateLimitKey,
  wildberriesSellerIdFromToken,
} from '../src/modules/marketplace-connections/wildberries-request-scheduler';

const WB_URL = 'https://marketplace-api.wildberries.ru/api/v3/orders/new';

describe('WildberriesRequestScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('groups different tokens by WB seller sid', () => {
    const first = jwt({ sid: 'seller-1', id: 'token-a' });
    const second = jwt({ sid: 'seller-1', id: 'token-b' });

    expect(wildberriesSellerIdFromToken(first)).toBe('seller-1');
    expect(wildberriesRateLimitKey(WB_URL, request(first))).toBe(
      wildberriesRateLimitKey(WB_URL, request(second)),
    );
  });

  it('serves an interactive request before queued background work', async () => {
    vi.useFakeTimers();
    const scheduler = new WildberriesRequestScheduler(100);
    const init = request(jwt({ sid: 'seller-1', id: 'token-a' }));
    const completed: string[] = [];

    await runWithWildberriesRequestPriority('background', () =>
      scheduler.waitForSlot(WB_URL, init),
    );
    const secondBackground = runWithWildberriesRequestPriority('background', () =>
      scheduler.waitForSlot(WB_URL, init).then(() => completed.push('background')),
    );
    const interactive = scheduler
      .waitForSlot(WB_URL, init)
      .then(() => completed.push('interactive'));

    await vi.advanceTimersByTimeAsync(100);
    expect(completed).toEqual(['interactive']);
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([secondBackground, interactive]);
    expect(completed).toEqual(['interactive', 'background']);
  });

  it('applies a 429 delay to every token of the same seller', async () => {
    vi.useFakeTimers();
    const scheduler = new WildberriesRequestScheduler(100);
    const first = request(jwt({ sid: 'seller-1', id: 'token-a' }));
    const second = request(jwt({ sid: 'seller-1', id: 'token-b' }));
    await scheduler.waitForSlot(WB_URL, first);
    scheduler.defer(WB_URL, first, 500);

    let completed = false;
    const pending = scheduler.waitForSlot(WB_URL, second).then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(completed).toBe(true);
  });
});

function request(token: string): RequestInit {
  return { method: 'GET', headers: { Authorization: token } };
}

function jwt(payload: Record<string, unknown>) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}


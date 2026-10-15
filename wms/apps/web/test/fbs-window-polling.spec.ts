import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { startVisiblePolling } from '../src/lib/visiblePolling';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// TEST: retained desktop windows must stop all four recurring FBS reads.
it('connects each FBS recurring read to its own visible window', () => {
  const source = readFileSync('src/components/fbs/FbsPanel.tsx', 'utf8');
  for (const name of ['loadOrders', 'loadActiveClients', 'loadMarketplaceOrderCounts', 'loadCargoPackings']) {
    expect(source.includes(`startVisiblePolling(() => void ${name}(), () => pollingRoot.current,`), name).toBe(true);
  }
  expect(source.match(/ref=\{pollingRoot\}/g)).toHaveLength(2);
});

// TEST: no traffic while minimized/hidden; immediate refresh once restored, cleanup stops it.
it('pauses a retained window and refreshes once when restored', () => {
  vi.useFakeTimers();
  let minimized = false;
  let mutation: () => void = () => {};
  const root = { isConnected: true, parentElement: null, hasAttribute: () => false,
    classList: { contains: () => minimized } };
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block' }));
  vi.stubGlobal('MutationObserver', class { constructor(fn: () => void) { mutation = fn; } observe() {} disconnect() {} });
  const refresh = vi.fn();
  const stop = startVisiblePolling(refresh, () => root as unknown as Element, 60_000);
  vi.advanceTimersByTime(60_000); expect(refresh).toHaveBeenCalledTimes(1);
  minimized = true; mutation(); vi.advanceTimersByTime(180_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  minimized = false; mutation(); mutation(); expect(refresh).toHaveBeenCalledTimes(2);
  stop(); vi.advanceTimersByTime(60_000); expect(refresh).toHaveBeenCalledTimes(2);
});

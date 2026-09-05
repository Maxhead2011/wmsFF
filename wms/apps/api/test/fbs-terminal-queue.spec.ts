import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFbsTerminalQueueOrder } from '../src/common/fbs-terminal-queue';

afterEach(() => vi.unstubAllEnvs());
describe('terminal WB queue policy', () => {
  // TEST: no behavior changes in sold/non-opted-in installations.
  it('defaults off', () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', '');
    expect(isFbsTerminalQueueOrder({ marketplace: 'WILDBERRIES', lastWbStatus: 'sold' })).toBe(false);
  });
  it.each(['sold', 'defect', 'canceled', 'canceled_by_client', 'declined_by_client', 'canceled_by_carrier'])(
    'excludes WB %s even if cached category still says active', lastWbStatus => {
      vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
      expect(isFbsTerminalQueueOrder({ marketplace: 'WILDBERRIES', lastCategory: 'active', lastWbStatus })).toBe(true);
    });
  it('does not apply WB status semantics to Ozon', () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    expect(isFbsTerminalQueueOrder({ marketplace: 'OZON', lastCategory: 'cancelled', lastWbStatus: 'sold' })).toBe(false);
  });
  it('does not infer fulfillment from missing status or complete/waiting', () => {
    vi.stubEnv('WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED', 'true');
    expect(isFbsTerminalQueueOrder(null)).toBe(false);
    expect(isFbsTerminalQueueOrder({ marketplace: 'WILDBERRIES', lastSupplierStatus: 'complete', lastWbStatus: 'waiting' })).toBe(false);
    expect(isFbsTerminalQueueOrder({ marketplace: 'WILDBERRIES' })).toBe(false);
  });
});

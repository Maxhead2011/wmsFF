import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsAutoSyncService } from '../src/modules/analytics/analytics-auto-sync.service';

describe('AnalyticsAutoSyncService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('обновляет активное подключение после начальной задержки', async () => {
    vi.useFakeTimers();
    const sync = vi.fn().mockResolvedValue({ sync: { status: 'READY' } });
    const syncRegionalDemand = vi.fn().mockResolvedValue({ rows: 100, source: 'REGION_SALE' });
    const analyticsPrisma = {
      analyticsConnection: { findMany: vi.fn().mockResolvedValue([{ clientId: 'client-1' }]) },
      analyticsSyncState: { findUnique: vi.fn().mockResolvedValue({ periodDays: 30, lastStartedAt: null }) },
    };
    const config = {
      get: (name: string) =>
        ['ANALYTICS_AUTO_SYNC_INITIAL_DELAY_MS', 'ANALYTICS_AUTO_SYNC_INTERVAL_MS', 'ANALYTICS_AUTO_SYNC_FAILED_RETRY_MS'].includes(name)
          ? '60000'
          : undefined,
    };
    const service = new AnalyticsAutoSyncService({ sync, syncRegionalDemand } as never, analyticsPrisma as never, config as never);

    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(syncRegionalDemand).toHaveBeenCalledWith('client-1', 30);
    expect(sync).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('повторяет региональную фазу после временной ошибки', async () => {
    vi.useFakeTimers();
    const syncRegionalDemand = vi
      .fn()
      .mockRejectedValueOnce(new Error('WB 429'))
      .mockResolvedValueOnce({ rows: 50, source: 'REGION_SALE' });
    const analyticsPrisma = {
      analyticsConnection: { findMany: vi.fn().mockResolvedValue([{ clientId: 'client-1' }]) },
      analyticsSyncState: { findUnique: vi.fn().mockResolvedValue({ periodDays: 30, lastStartedAt: null }) },
    };
    const config = {
      get: (name: string) =>
        ['ANALYTICS_AUTO_SYNC_INITIAL_DELAY_MS', 'ANALYTICS_AUTO_SYNC_INTERVAL_MS', 'ANALYTICS_AUTO_SYNC_FAILED_RETRY_MS'].includes(name)
          ? '60000'
          : undefined,
    };
    const service = new AnalyticsAutoSyncService(
      { sync: vi.fn(), syncRegionalDemand } as never,
      analyticsPrisma as never,
      config as never,
    );

    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(syncRegionalDemand).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });
});

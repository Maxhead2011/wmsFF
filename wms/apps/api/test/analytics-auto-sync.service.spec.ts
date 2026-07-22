import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsAutoSyncService } from '../src/modules/analytics/analytics-auto-sync.service';

describe('AnalyticsAutoSyncService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('обновляет активное подключение после начальной задержки', async () => {
    vi.useFakeTimers();
    const sync = vi.fn().mockResolvedValue({ sync: { status: 'READY' } });
    const analyticsPrisma = {
      analyticsConnection: { findMany: vi.fn().mockResolvedValue([{ clientId: 'client-1' }]) },
      analyticsSyncState: { findUnique: vi.fn().mockResolvedValue({ periodDays: 30, lastStartedAt: null }) },
    };
    const config = {
      get: (name: string) =>
        name === 'ANALYTICS_AUTO_SYNC_INITIAL_DELAY_MS' || name === 'ANALYTICS_AUTO_SYNC_INTERVAL_MS'
          ? '60000'
          : undefined,
    };
    const service = new AnalyticsAutoSyncService({ sync } as never, analyticsPrisma as never, config as never);

    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sync).toHaveBeenCalledWith(
      { clientId: 'client-1', periodDays: 30 },
      expect.objectContaining({ analyticsEnabled: true, clientScopeMode: 'ALL' }),
    );
    service.onModuleDestroy();
  });
});

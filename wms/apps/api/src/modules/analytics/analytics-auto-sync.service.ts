import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../auth/auth.types';
import { AnalyticsPrismaService } from './analytics-prisma.service';
import { AnalyticsService } from './analytics.service';

const DEFAULT_INTERVAL_MS = 60 * 60_000;
const DEFAULT_INITIAL_DELAY_MS = 15 * 60_000;
const MINIMUM_RETRY_AGE_MS = 15 * 60_000;

const AUTO_SYNC_USER: AuthUser = {
  id: 'analytics-auto-sync',
  email: 'analytics-auto-sync@system.local',
  name: 'Автообновление аналитики',
  analyticsEnabled: true,
  roleCodes: ['ADMIN'],
  permissionCodes: ['system:admin'],
  clientScopeMode: 'ALL',
  clientIds: [],
  writableClientIds: [],
};

@Injectable()
export class AnalyticsAutoSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsAutoSyncService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly analytics: AnalyticsService,
    private readonly analyticsPrisma: AnalyticsPrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('ANALYTICS_AUTO_SYNC_ENABLED') === 'false') {
      this.logger.log('Автоматическое обновление аналитики отключено настройкой окружения.');
      return;
    }
    this.schedule(this.duration('ANALYTICS_AUTO_SYNC_INITIAL_DELAY_MS', DEFAULT_INITIAL_DELAY_MS));
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delayMs: number) {
    this.timer = setTimeout(() => void this.run(), delayMs);
    this.timer.unref?.();
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      const connections = await this.analyticsPrisma.analyticsConnection.findMany({
        where: { isActive: true },
        select: { clientId: true },
      });
      for (const connection of connections) {
        const state = await this.analyticsPrisma.analyticsSyncState.findUnique({ where: { clientId: connection.clientId } });
        if (state?.lastStartedAt && Date.now() - state.lastStartedAt.getTime() < MINIMUM_RETRY_AGE_MS) continue;
        const periodDays = state?.periodDays === 7 || state?.periodDays === 90 ? state.periodDays : 30;
        try {
          const result = await this.analytics.sync({ clientId: connection.clientId, periodDays }, AUTO_SYNC_USER);
          this.logger.log(`Аналитика клиента ${connection.clientId} обновлена: ${result.sync?.status ?? 'READY'}.`);
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'неизвестная ошибка';
          this.logger.warn(`Автообновление аналитики клиента ${connection.clientId} не выполнено: ${message}`);
        }
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'неизвестная ошибка';
      this.logger.warn(`Цикл автообновления аналитики не выполнен: ${message}`);
    } finally {
      this.running = false;
      this.schedule(this.duration('ANALYTICS_AUTO_SYNC_INTERVAL_MS', DEFAULT_INTERVAL_MS));
    }
  }

  private duration(name: string, fallback: number) {
    const configured = Number(this.config.get<string>(name));
    return Number.isFinite(configured) && configured >= 60_000 ? configured : fallback;
  }
}

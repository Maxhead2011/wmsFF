import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsAutoSyncService } from './analytics-auto-sync.service';
import { AnalyticsCryptoService } from './analytics-crypto.service';
import { AnalyticsPrismaService } from './analytics-prisma.service';
import { AnalyticsService } from './analytics.service';
import { FulfillmentAnalyticsService } from './fulfillment.service';
import { FulfillmentAnalyticsController } from './fulfillment.controller';

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController, FulfillmentAnalyticsController],
  providers: [AnalyticsPrismaService, AnalyticsCryptoService, AnalyticsService, AnalyticsAutoSyncService, FulfillmentAnalyticsService],
})
export class AnalyticsModule {}

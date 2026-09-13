import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OperationsStatisticsController } from './operations-statistics.controller';
import { OperationsStatisticsService } from './operations-statistics.service';
import { StatisticsRefreshService } from './statistics-refresh.service';
@Module({ imports: [AuthModule], controllers: [OperationsStatisticsController], providers: [OperationsStatisticsService, StatisticsRefreshService] })
export class OperationsStatisticsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WmsStockAvailabilityService } from '../stock/wms-stock-availability.service';
import { FbsStockReportsService } from './fbs-stock-reports.service';
import { TurnoverController } from './turnover.controller';
import { TurnoverService } from './turnover.service';

@Module({
  imports: [AuthModule],
  controllers: [TurnoverController],
  providers: [TurnoverService, FbsStockReportsService, WmsStockAvailabilityService],
})
export class TurnoverModule {}

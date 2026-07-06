import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StockModule } from '../stock/stock.module';
import { TsdDeviceController } from './tsd-device.controller';
import { TsdAssemblyService } from './tsd-assembly.service';
import { TsdDeviceService } from './tsd-device.service';
import { TsdOperationLogService } from './tsd-operation-log.service';
import { TsdPayloadParser } from './tsd-payload.parser';
import { TsdReceiptService } from './tsd-receipt.service';
import { TsdReviewService } from './tsd-review.service';
import { TsdSyncController } from './tsd-sync.controller';
import { TsdSyncService } from './tsd-sync.service';

@Module({
  imports: [AuthModule, StockModule],
  controllers: [TsdDeviceController, TsdSyncController],
  providers: [
    TsdAssemblyService,
    TsdDeviceService,
    TsdOperationLogService,
    TsdPayloadParser,
    TsdReceiptService,
    TsdReviewService,
    TsdSyncService,
  ],
})
export class TsdModule {}

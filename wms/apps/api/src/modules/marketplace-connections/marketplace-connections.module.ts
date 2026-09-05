import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { WmsStockAvailabilityService } from '../stock/wms-stock-availability.service';
import { FbsPenaltiesReportService } from './fbs-penalties-report.service';
import { FbsProductShipmentsReportService } from './fbs-product-shipments-report.service';
import { FbsStockAllocationExternalController } from './fbs-stock-allocation-external.controller';
import { FbsStockAllocationService } from './fbs-stock-allocation.service';
import { FbsStockMonitoringService } from './fbs-stock-monitoring.service';
import { MarketplaceConnectionsController } from './marketplace-connections.controller';
import { MarketplaceConnectionsService } from './marketplace-connections.service';
import { MarketplaceStockControlService } from './marketplace-stock-control.service';
import { FbsRepeatAssemblyService } from './fbs-repeat-assembly.service';
import { FbsRepeatAssemblyController } from './fbs-repeat-assembly.controller';

@Module({
  imports: [AuthModule, LogisticsModule],
  controllers: [MarketplaceConnectionsController, FbsStockAllocationExternalController, FbsRepeatAssemblyController],
  providers: [
    MarketplaceStockControlService,
    // FIX: keep current stock-control registration when adding independent repeats.
    FbsRepeatAssemblyService,
    MarketplaceConnectionsService,
    // ADDED: isolated read-only WB Finance integration for FBS penalties.
    FbsPenaltiesReportService,
    FbsProductShipmentsReportService,
    FbsStockAllocationService,
    FbsStockMonitoringService,
    // ADDED: one read-only availability calculation is shared by reports and Excel.
    WmsStockAvailabilityService,
  ],
  exports: [MarketplaceConnectionsService, FbsStockMonitoringService, MarketplaceStockControlService],
})
export class MarketplaceConnectionsModule {}

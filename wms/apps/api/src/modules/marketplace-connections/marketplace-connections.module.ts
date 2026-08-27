import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { WmsStockAvailabilityService } from '../stock/wms-stock-availability.service';
import { FbsProductShipmentsReportService } from './fbs-product-shipments-report.service';
import { FbsStockAllocationExternalController } from './fbs-stock-allocation-external.controller';
import { FbsStockAllocationService } from './fbs-stock-allocation.service';
import { FbsStockMonitoringService } from './fbs-stock-monitoring.service';
import { MarketplaceConnectionsController } from './marketplace-connections.controller';
import { MarketplaceConnectionsService } from './marketplace-connections.service';

@Module({
  imports: [AuthModule, LogisticsModule],
  controllers: [MarketplaceConnectionsController, FbsStockAllocationExternalController],
  providers: [
    MarketplaceConnectionsService,
    FbsProductShipmentsReportService,
    FbsStockAllocationService,
    FbsStockMonitoringService,
    // ADDED: one read-only availability calculation is shared by reports and Excel.
    WmsStockAvailabilityService,
  ],
  exports: [MarketplaceConnectionsService, FbsStockMonitoringService],
})
export class MarketplaceConnectionsModule {}

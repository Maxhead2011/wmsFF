import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { FbsProductShipmentsReportService } from './fbs-product-shipments-report.service';
import { FbsStockAllocationExternalController } from './fbs-stock-allocation-external.controller';
import { FbsStockAllocationService } from './fbs-stock-allocation.service';
import { MarketplaceConnectionsController } from './marketplace-connections.controller';
import { MarketplaceConnectionsService } from './marketplace-connections.service';

@Module({
  imports: [AuthModule, LogisticsModule],
  controllers: [MarketplaceConnectionsController, FbsStockAllocationExternalController],
  providers: [MarketplaceConnectionsService, FbsProductShipmentsReportService, FbsStockAllocationService],
  exports: [MarketplaceConnectionsService],
})
export class MarketplaceConnectionsModule {}

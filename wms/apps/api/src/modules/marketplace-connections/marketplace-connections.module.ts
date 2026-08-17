import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { FbsProductShipmentsReportService } from './fbs-product-shipments-report.service';
import { MarketplaceConnectionsController } from './marketplace-connections.controller';
import { MarketplaceConnectionsService } from './marketplace-connections.service';

@Module({
  imports: [AuthModule, LogisticsModule],
  controllers: [MarketplaceConnectionsController],
  providers: [MarketplaceConnectionsService, FbsProductShipmentsReportService],
  exports: [MarketplaceConnectionsService],
})
export class MarketplaceConnectionsModule {}

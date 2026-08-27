import { Module } from '@nestjs/common';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';
import { MarketplaceConnectionsModule } from '../marketplace-connections/marketplace-connections.module';
import { StockModule } from '../stock/stock.module';
import { PhantomStockService } from './phantom-stock.service';
import { AdministrationTechnicalWorkService } from './administration-technical-work.service';
import { AdministrationInternalApiService } from './administration-internal-api.service';

@Module({
  imports: [MarketplaceConnectionsModule, StockModule],
  controllers: [AdministrationController],
  // ADDED: Internal API diagnostics are isolated from existing technical-work repair logic.
  providers: [
    AdministrationService,
    AdministrationTechnicalWorkService,
    AdministrationInternalApiService,
    PhantomStockService,
  ],
  exports: [AdministrationService],
})
export class AdministrationModule {}

import { Module } from '@nestjs/common';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';
import { MarketplaceConnectionsModule } from '../marketplace-connections/marketplace-connections.module';
import { StockModule } from '../stock/stock.module';
import { PhantomStockService } from './phantom-stock.service';
import { AdministrationTechnicalWorkService } from './administration-technical-work.service';

@Module({
  imports: [MarketplaceConnectionsModule, StockModule],
  controllers: [AdministrationController],
  providers: [AdministrationService, AdministrationTechnicalWorkService, PhantomStockService],
  exports: [AdministrationService],
})
export class AdministrationModule {}

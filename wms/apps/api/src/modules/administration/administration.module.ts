import { Module } from '@nestjs/common';
import { AutoAssemblyController } from './auto-assembly.controller';
import { AutoAssemblyService } from './auto-assembly.service';
import { AuthModule } from '../auth/auth.module';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';
import { MarketplaceConnectionsModule } from '../marketplace-connections/marketplace-connections.module';
import { StockModule } from '../stock/stock.module';
import { PhantomStockService } from './phantom-stock.service';
import { AdministrationTechnicalWorkService } from './administration-technical-work.service';
import { AdministrationInternalApiService } from './administration-internal-api.service';
import { AdministrationUnpalletedWriteoffService } from './administration-unpalleted-writeoff.service';
import { InventoryModule } from '../inventory/inventory.module';
import { AdministrationMarketplaceStockControlController } from './administration-marketplace-stock-control.controller';

@Module({
  imports: [AuthModule, MarketplaceConnectionsModule, StockModule, InventoryModule],
  controllers: [AutoAssemblyController, AdministrationController, AdministrationMarketplaceStockControlController],
  // ADDED: Internal API diagnostics are isolated from existing technical-work repair logic.
  providers: [
    AutoAssemblyService,
    AdministrationService,
    AdministrationTechnicalWorkService,
    AdministrationInternalApiService,
    // FIX: destructive unpalleted-box cleanup is isolated from existing repair flows.
    AdministrationUnpalletedWriteoffService,
    PhantomStockService,
  ],
  exports: [AdministrationService],
})
export class AdministrationModule {}

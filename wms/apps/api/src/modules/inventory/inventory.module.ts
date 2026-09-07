import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StockModule } from '../stock/stock.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { SkuCollectionService } from './sku-collection.service';
import { SkuSortingService } from './sku-sorting.service';
import { MarketplaceConnectionsModule } from '../marketplace-connections/marketplace-connections.module';
import { PalletSortingController } from './pallet-sorting.controller';
import { PalletSortingService } from './pallet-sorting.service';

@Module({
  imports: [AuthModule, StockModule, MarketplaceConnectionsModule],
  controllers: [InventoryController, PalletSortingController],
  providers: [InventoryService, SkuCollectionService, SkuSortingService, PalletSortingService],
  // FIX: administration reuses the inventory-owned resolved-session invariant.
  exports: [InventoryService, SkuCollectionService, SkuSortingService],
})
export class InventoryModule {}

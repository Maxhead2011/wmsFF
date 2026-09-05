import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StockModule } from '../stock/stock.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { SkuCollectionService } from './sku-collection.service';
import { SkuSortingService } from './sku-sorting.service';

@Module({
  imports: [AuthModule, StockModule],
  controllers: [InventoryController],
  providers: [InventoryService, SkuCollectionService, SkuSortingService],
  // FIX: administration reuses the inventory-owned resolved-session invariant.
  exports: [InventoryService, SkuCollectionService, SkuSortingService],
})
export class InventoryModule {}

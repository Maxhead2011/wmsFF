import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StockModule } from '../stock/stock.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [AuthModule, StockModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  // FIX: administration reuses the inventory-owned resolved-session invariant.
  exports: [InventoryService],
})
export class InventoryModule {}

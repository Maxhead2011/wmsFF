import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ClientNotificationsModule } from '../client-notifications/client-notifications.module';
import { StockModule } from '../stock/stock.module';
import { WarehouseController } from './warehouse.controller';
import { WarehouseBoxIntegrityService } from './warehouse-box-integrity.service';
import { WarehouseShipmentHistoryService } from './warehouse-shipment-history.service';
import { WarehouseService } from './warehouse.service';
import { StorageLocationsController } from './storage-locations.controller';
import { StorageLocationsService } from './storage-locations.service';

@Module({
  imports: [AuthModule, BillingModule, ClientNotificationsModule, StockModule],
  controllers: [WarehouseController, StorageLocationsController],
  providers: [
    WarehouseService,
    StorageLocationsService,
    WarehouseBoxIntegrityService,
    WarehouseShipmentHistoryService,
  ],
  exports: [WarehouseService, StorageLocationsService],
})
export class WarehouseModule {}

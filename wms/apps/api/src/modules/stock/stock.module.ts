import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RequestBillingAutomationService } from '../billing/request-billing-automation.service';
import { ClientNotificationsModule } from '../client-notifications/client-notifications.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { FulfillmentWaveService } from './fulfillment-wave.service';
import { FbsRequestBoxAuditService } from './fbs-request-box-audit.service';
import { PickInstructionService } from './pick-instruction.service';
import { PickWaveDocumentService } from './pick-wave-document.service';
import { StockController } from './stock.controller';
import { StockBalancesService } from './stock-balances.service';
import { StockLedgerService } from './stock-ledger.service';
import { StockOperationsService } from './stock-operations.service';
import { StorageOverviewService } from './storage-overview.service';
import { VolumeService } from './volume.service';

@Module({
  imports: [AuthModule, ClientNotificationsModule, ExpensesModule, LogisticsModule],
  controllers: [StockController],
  providers: [
    StockBalancesService,
    StockLedgerService,
    StockOperationsService,
    StorageOverviewService,
    RequestBillingAutomationService,
    FulfillmentWaveService,
    FbsRequestBoxAuditService,
    PickInstructionService,
    PickWaveDocumentService,
    VolumeService,
  ],
  exports: [
    StockBalancesService,
    StockLedgerService,
    StockOperationsService,
    StorageOverviewService,
    FulfillmentWaveService,
    FbsRequestBoxAuditService,
    PickInstructionService,
    PickWaveDocumentService,
    VolumeService,
    RequestBillingAutomationService,
  ],
})
export class StockModule {}

import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { ClientNotificationsModule } from '../client-notifications/client-notifications.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { MarketplaceConnectionsModule } from '../marketplace-connections/marketplace-connections.module';
import { OwnCompaniesModule } from '../own-companies/own-companies.module';
import { BillingDocumentService } from './billing-document.service';
import { BillingPdfService } from './billing-pdf.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [
    AuthModule,
    CommonModule,
    ClientNotificationsModule,
    LogisticsModule,
    MarketplaceConnectionsModule,
    OwnCompaniesModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, BillingDocumentService, BillingPdfService],
  exports: [BillingService],
})
export class BillingModule {}

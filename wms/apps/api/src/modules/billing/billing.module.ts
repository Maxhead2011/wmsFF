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
import { BillingPeriodService } from './billing-period.service';
// FIX: opt-in, read-only settlements workspace.
import { BillingSettlementsController } from './billing-settlements.controller';
import { BillingSettlementsService } from './billing-settlements.service';
import { BillingPeriodCloseController } from './billing-period-close.controller';
import { BillingPeriodCloseService } from './billing-period-close.service';
import { FboProcessingPricingService } from './fbo-processing-pricing.service';
import { FboProcessingPricingController } from './fbo-processing-pricing.controller';

@Module({
  imports: [
    AuthModule,
    CommonModule,
    ClientNotificationsModule,
    LogisticsModule,
    MarketplaceConnectionsModule,
    OwnCompaniesModule,
  ],
  controllers: [BillingController, BillingSettlementsController, BillingPeriodCloseController, FboProcessingPricingController],
  providers: [BillingService, BillingDocumentService, BillingPdfService, BillingPeriodService, BillingSettlementsService, BillingPeriodCloseService, FboProcessingPricingService],
  exports: [BillingService],
})
export class BillingModule {}

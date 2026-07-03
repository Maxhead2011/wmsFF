import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { ClientNotificationsModule } from '../client-notifications/client-notifications.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { OwnCompaniesModule } from '../own-companies/own-companies.module';
import { BillingDocumentService } from './billing-document.service';
import { BillingPdfService } from './billing-pdf.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { RequestBillingAutomationService } from './request-billing-automation.service';

@Module({
  imports: [AuthModule, CommonModule, ClientNotificationsModule, OwnCompaniesModule, LogisticsModule],
  controllers: [BillingController],
  providers: [BillingService, BillingDocumentService, BillingPdfService, RequestBillingAutomationService],
  exports: [RequestBillingAutomationService],
})
export class BillingModule {}

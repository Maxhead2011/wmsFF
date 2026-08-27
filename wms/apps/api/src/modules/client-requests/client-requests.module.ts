import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { ClientNotificationsModule } from '../client-notifications/client-notifications.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { MarketplaceConnectionsModule } from '../marketplace-connections/marketplace-connections.module';
import { StockModule } from '../stock/stock.module';
import { ClientRequestDocumentService } from './client-request-document.service';
import { ClientRequestEmergencyService } from './client-request-emergency.service';
import { ClientRequestFilesService } from './client-request-files.service';
import { ClientRequestHistoryService } from './client-request-history.service';
import { ClientRequestMarketplaceFilesService } from './client-request-marketplace-files.service';
import { ClientRequestPdfService } from './client-request-pdf.service';
import { ClientRequestXlsxService } from './client-request-xlsx.service';
import { ClientRequestsController } from './client-requests.controller';
import { ClientRequestsService } from './client-requests.service';

@Module({
  imports: [AuthModule, CommonModule, ClientNotificationsModule, StockModule, LogisticsModule, MarketplaceConnectionsModule],
  controllers: [ClientRequestsController],
  providers: [
    ClientRequestsService,
    ClientRequestDocumentService,
    ClientRequestEmergencyService,
    ClientRequestPdfService,
    ClientRequestFilesService,
    ClientRequestHistoryService,
    ClientRequestMarketplaceFilesService,
    ClientRequestXlsxService,
  ],
})
export class ClientRequestsModule {}

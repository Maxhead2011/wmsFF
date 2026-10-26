import { OzonLinkImportService } from './ozon-link-import.service';
import { ClientRequestRemovalService } from './client-request-removal.service';
import { ClientRequestRemovalController } from './client-request-removal.controller';
import { OzonAssemblySupplyController } from './ozon-assembly-supply.controller';
import { OzonAssemblySupplyService } from './ozon-assembly-supply.service';
import { Module } from '@nestjs/common';
import { OzonFboImportController } from './ozon-fbo-import.controller';
import { OzonFboImportService } from './ozon-fbo-import.service';
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
  controllers: [ClientRequestRemovalController, OzonAssemblySupplyController, ClientRequestsController, OzonFboImportController],
  // FIX: Lamoda preview reuses scoped availability; no duplicate stock calculator.
  exports: [ClientRequestsService],
  providers: [
    ClientRequestRemovalService,
    OzonLinkImportService,
    OzonFboImportService,
    OzonAssemblySupplyService,
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

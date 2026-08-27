import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StockModule } from '../stock/stock.module';
import { IntegrationAccessController } from './integration-access.controller';
import { IntegrationAccessService } from './integration-access.service';
import { IntegrationApiController } from './integration-api.controller';
import { IntegrationApiGuard } from './integration-api.guard';
import { IntegrationApiService } from './integration-api.service';

@Module({
  imports: [AuthModule, StockModule],
  controllers: [IntegrationAccessController, IntegrationApiController],
  providers: [IntegrationAccessService, IntegrationApiGuard, IntegrationApiService],
})
export class IntegrationApiModule {}

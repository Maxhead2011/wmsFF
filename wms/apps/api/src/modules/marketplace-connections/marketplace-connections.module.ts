import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { MarketplaceConnectionsController } from './marketplace-connections.controller';
import { MarketplaceConnectionsService } from './marketplace-connections.service';

@Module({
  imports: [AuthModule, LogisticsModule],
  controllers: [MarketplaceConnectionsController],
  providers: [MarketplaceConnectionsService],
})
export class MarketplaceConnectionsModule {}

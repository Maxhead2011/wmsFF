import { Module } from '@nestjs/common';
import { MarketplaceConnectionsModule } from '../marketplace-connections/marketplace-connections.module';
import { KizIssuesController } from './kiz-issues.controller';
import { KizIssuesService } from './kiz-issues.service';

@Module({
  imports: [MarketplaceConnectionsModule],
  controllers: [KizIssuesController],
  providers: [KizIssuesService],
})
export class KizIssuesModule {}

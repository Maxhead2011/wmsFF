import { Module } from '@nestjs/common';
import { MarketplaceConnectionsModule } from '../marketplace-connections/marketplace-connections.module';
import { KizCirculationController } from './kiz-circulation.controller';
import { KizCirculationCryptoService } from './kiz-circulation-crypto.service';
import { KizCirculationService } from './kiz-circulation.service';

@Module({
  imports: [MarketplaceConnectionsModule],
  controllers: [KizCirculationController],
  providers: [KizCirculationCryptoService, KizCirculationService],
})
export class KizCirculationModule {}

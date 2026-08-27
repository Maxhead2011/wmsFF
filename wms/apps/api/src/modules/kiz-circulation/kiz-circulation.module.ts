import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketplaceConnectionsModule } from '../marketplace-connections/marketplace-connections.module';
import { KizCirculationController } from './kiz-circulation.controller';
import { KizCirculationCryptoService } from './kiz-circulation-crypto.service';
import { KizCirculationService } from './kiz-circulation.service';

@Module({
  // FIX: KizCirculationService получает ClientScopeService из AuthModule.
  imports: [AuthModule, MarketplaceConnectionsModule],
  controllers: [KizCirculationController],
  providers: [KizCirculationCryptoService, KizCirculationService],
})
export class KizCirculationModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { MobileAuthService } from './mobile-auth.service';
import { MobileController } from './mobile.controller';
import { MobilePushService } from './mobile-push.service';
import { MobileService } from './mobile.service';

@Module({
  imports: [AuthModule, WarehouseModule],
  controllers: [MobileController],
  providers: [MobileAuthService, MobileService, MobilePushService],
  exports: [MobileService, MobilePushService],
})
export class MobileModule {}

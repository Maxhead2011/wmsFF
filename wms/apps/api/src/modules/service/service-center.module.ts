import { Module } from '@nestjs/common';
import { ClientNotificationsModule } from '../client-notifications/client-notifications.module';
import { ServiceCenterController } from './service-center.controller';
import { ServiceCenterService } from './service-center.service';
import { StorageOptimizationService } from './storage-optimization.service';
import { UnprintedKizController } from './unprinted-kiz.controller';
import { UnprintedKizService } from './unprinted-kiz.service';

@Module({
  imports: [ClientNotificationsModule],
  controllers: [ServiceCenterController, UnprintedKizController],
  providers: [ServiceCenterService, StorageOptimizationService, UnprintedKizService],
})
export class ServiceCenterModule {}

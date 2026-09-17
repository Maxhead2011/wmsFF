import { Module } from '@nestjs/common';
import { ClientNotificationsModule } from '../client-notifications/client-notifications.module';
import { ServiceCenterController } from './service-center.controller';
import { ServiceCenterService } from './service-center.service';
import { StorageOptimizationService } from './storage-optimization.service';
import { AuthModule } from '../auth/auth.module';
import { WbPrintCheckService } from './wb-print-check.service';

@Module({
  imports: [ClientNotificationsModule, AuthModule],
  controllers: [ServiceCenterController],
  providers: [ServiceCenterService, StorageOptimizationService, WbPrintCheckService],
})
export class ServiceCenterModule {}

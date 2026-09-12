import { Global, Module } from '@nestjs/common';
import { AdminNotificationsService } from './admin-notifications.service';
import { AdminNotificationsController } from './admin-notifications.controller';
@Global()
@Module({ providers: [AdminNotificationsService], controllers: [AdminNotificationsController], exports: [AdminNotificationsService] })
export class AdminNotificationsModule {}

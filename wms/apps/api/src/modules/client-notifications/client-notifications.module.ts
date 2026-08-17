import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientNotificationsController } from './client-notifications.controller';
import { ClientNotificationsService } from './client-notifications.service';
import { TelegramNotificationService } from './telegram-notification.service';

@Module({
  imports: [AuthModule],
  controllers: [ClientNotificationsController],
  providers: [ClientNotificationsService, TelegramNotificationService],
  exports: [ClientNotificationsService, TelegramNotificationService],
})
export class ClientNotificationsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientRequestsModule } from '../client-requests/client-requests.module';
import { YandexFbyController } from './yandex-fby.controller';
import { YandexFbyService } from './yandex-fby.service';
@Module({ imports: [AuthModule, ClientRequestsModule], controllers: [YandexFbyController], providers: [YandexFbyService] })
export class YandexFbyModule {}

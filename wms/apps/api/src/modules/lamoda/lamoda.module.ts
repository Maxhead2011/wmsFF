import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientRequestsModule } from '../client-requests/client-requests.module';
import { LamodaController } from './lamoda.controller';
import { LamodaService } from './lamoda.service';

@Module({ imports: [AuthModule, ClientRequestsModule], controllers: [LamodaController], providers: [LamodaService] })
export class LamodaModule {}

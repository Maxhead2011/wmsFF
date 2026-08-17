import { Module } from '@nestjs/common';
import { FactoryShipmentsController } from './factory-shipments.controller';
import { FactoryShipmentsService } from './factory-shipments.service';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [FactoryShipmentsController], providers: [FactoryShipmentsService] })
export class FactoryShipmentsModule {}

import { Module } from '@nestjs/common';
import { ClientKizPolicyController } from './client-kiz-policy.controller';
import { ClientKizPolicyService } from './client-kiz-policy.service';
import { AuthModule } from '../auth/auth.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientStoresService } from './client-stores.service';
import { ClientStoresController } from './client-stores.controller';
import { ProductDisplayController } from './product-display.controller';
import { ProductDisplayService } from './product-display.service';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ProductDisplayInterceptor } from './product-display.interceptor';

@Module({
  imports: [AuthModule],
  controllers: [ClientsController, ProductDisplayController, ClientStoresController, ClientKizPolicyController],
  providers: [ClientsService, ClientStoresService, ProductDisplayService, ClientKizPolicyService, { provide: APP_INTERCEPTOR, useClass: ProductDisplayInterceptor }],
  exports: [ClientsService, ClientStoresService],
})
export class ClientsModule {}

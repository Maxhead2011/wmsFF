import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { ClientNotificationsModule } from './modules/client-notifications/client-notifications.module';
import { ClientRequestsModule } from './modules/client-requests/client-requests.module';
import { AuthGuard } from './modules/auth/guards/auth.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { HealthController } from './modules/health/health.controller';
import { ClientsModule } from './modules/clients/clients.module';
import { ImportsModule } from './modules/imports/imports.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { LogisticsModule } from './modules/logistics/logistics.module';
import { MarketplaceConnectionsModule } from './modules/marketplace-connections/marketplace-connections.module';
import { MobileModule } from './modules/mobile/mobile.module';
import { MobileIdempotencyInterceptor } from './modules/mobile/mobile-idempotency.interceptor';
import { OwnCompaniesModule } from './modules/own-companies/own-companies.module';
import { PrintModule } from './modules/print/print.module';
import { ServiceCenterModule } from './modules/service/service-center.module';
import { SkusModule } from './modules/skus/skus.module';
import { StockModule } from './modules/stock/stock.module';
import { TsdModule } from './modules/tsd/tsd.module';
import { TurnoverModule } from './modules/turnover/turnover.module';
import { UsersModule } from './modules/users/users.module';
import { WarehouseModule } from './modules/warehouse/warehouse.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    AuthModule,
    BillingModule,
    ClientNotificationsModule,
    ClientRequestsModule,
    UsersModule,
    ClientsModule,
    SkusModule,
    WarehouseModule,
    StockModule,
    LogisticsModule,
    MarketplaceConnectionsModule,
    MobileModule,
    OwnCompaniesModule,
    ImportsModule,
    InventoryModule,
    PrintModule,
    ServiceCenterModule,
    TsdModule,
    TurnoverModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: MobileIdempotencyInterceptor,
    },
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KizSearchController } from './kiz-search.controller';
import { KizSearchService } from './kiz-search.service';
// FIX: disabled by default; enabled only on our WMS via WMS_TSD_KIZ_SEARCH.
@Module({ imports: [AuthModule], controllers: [KizSearchController], providers: [KizSearchService] })
export class KizSearchModule {}

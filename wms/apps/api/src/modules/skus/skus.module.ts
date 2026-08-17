import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StockModule } from '../stock/stock.module';
import { SkusController } from './skus.controller';
import { SkusService } from './skus.service';

@Module({
  imports: [AuthModule, StockModule],
  controllers: [SkusController],
  providers: [SkusService],
  exports: [SkusService],
})
export class SkusModule {}

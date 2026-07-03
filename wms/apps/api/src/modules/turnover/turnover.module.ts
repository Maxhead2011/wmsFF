import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TurnoverController } from './turnover.controller';
import { TurnoverService } from './turnover.service';

@Module({
  imports: [AuthModule],
  controllers: [TurnoverController],
  providers: [TurnoverService],
})
export class TurnoverModule {}

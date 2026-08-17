import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OzonFboController } from './ozon-fbo.controller';
import { OzonFboService } from './ozon-fbo.service';

@Module({
  imports: [AuthModule],
  controllers: [OzonFboController],
  providers: [OzonFboService],
})
export class OzonFboModule {}

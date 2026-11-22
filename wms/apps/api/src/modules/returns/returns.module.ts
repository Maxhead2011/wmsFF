import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReturnsService } from './returns.service';
import { ReturnsController } from './returns.controller';
@Module({ imports: [AuthModule], providers: [ReturnsService], controllers: [ReturnsController] })
export class ReturnsModule {}

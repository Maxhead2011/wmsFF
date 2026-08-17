import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WmsAiController } from './wms-ai.controller';
import { WmsAiInternetService } from './wms-ai-internet.service';
import { WmsAiLocalModelService } from './wms-ai-local-model.service';
import { WmsAiService } from './wms-ai.service';

@Module({
  imports: [AuthModule],
  controllers: [WmsAiController],
  providers: [WmsAiService, WmsAiInternetService, WmsAiLocalModelService],
})
export class WmsAiModule {}

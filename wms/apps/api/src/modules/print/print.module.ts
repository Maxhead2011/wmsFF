import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { LabelTemplateService } from './label-template.service';
import { PrintJobService } from './print-job.service';
import { PrintPrinterService } from './print-printer.service';
import { PrintQueueWorkerService } from './print-queue-worker.service';
import { PrintController } from './print.controller';
import { PrintAgentService } from './print-agent.service';
import { TsplLabelService } from './tspl-label.service';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [PrintController],
  providers: [LabelTemplateService, PrintJobService, PrintPrinterService, PrintQueueWorkerService, PrintAgentService, TsplLabelService],
  exports: [LabelTemplateService, PrintJobService, PrintPrinterService, PrintQueueWorkerService, TsplLabelService],
})
export class PrintModule {}

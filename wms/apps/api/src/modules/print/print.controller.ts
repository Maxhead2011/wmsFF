import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateLabelTemplateDto } from './dto/create-label-template.dto';
import { CreatePrintJobFromTemplateDto } from './dto/create-print-job.dto';
import { ListLabelTemplatesDto } from './dto/list-label-templates.dto';
import { ListPrintJobsDto } from './dto/list-print-jobs.dto';
import { ProcessPrintQueueDto } from './dto/process-print-queue.dto';
import { PreviewLabelTemplateDto } from './dto/preview-label-template.dto';
import { PreviewBoxLabelDto } from './dto/preview-box-label.dto';
import { PreviewPalletLabelDto } from './dto/preview-pallet-label.dto';
import { PreviewSkuLabelDto } from './dto/preview-sku-label.dto';
import { ReprintPrintJobDto } from './dto/reprint-print-job.dto';
import { UpdateLabelTemplateDto } from './dto/update-label-template.dto';
import { UpdatePrintJobStatusDto } from './dto/update-print-job-status.dto';
import { UpsertPrintPrinterDto } from './dto/upsert-print-printer.dto';
import { LabelTemplateService } from './label-template.service';
import { PrintJobService } from './print-job.service';
import { PrintPrinterService } from './print-printer.service';
import { PrintQueueWorkerService } from './print-queue-worker.service';
import { PrintAgentService } from './print-agent.service';
import { TsplLabelService } from './tspl-label.service';

@ApiTags('print')
@RequirePermissions('print:write')
@Controller('print')
export class PrintController {
  constructor(
    private readonly labels: TsplLabelService,
    private readonly templates: LabelTemplateService,
    private readonly jobs: PrintJobService,
    private readonly printers: PrintPrinterService,
    private readonly queue: PrintQueueWorkerService,
    private readonly agent: PrintAgentService,
  ) {}

  @Get('printers')
  listPrinters(@CurrentUser() user: AuthUser) {
    return this.printers.listPrinters(user);
  }

  @Get('agent-stations')
  listAgentStations() {
    return this.agent.listStations();
  }

  @Post('agent-jobs')
  createAgentSkuJob(@Body() body: { stationId?: string; skuId?: string; barcode?: string; imageBase64?: string; copies?: number; widthMm?: number; heightMm?: number }, @CurrentUser() user: AuthUser) {
    return this.agent.createSkuJob(body ?? {}, user);
  }

  @Post('agent-custom-jobs')
  createAgentCustomJob(@Body() body: { stationId?: string; clientId?: string; value?: string; imageBase64?: string; copies?: number; widthMm?: number; heightMm?: number }, @CurrentUser() user: AuthUser) {
    return this.agent.createCustomJob(body ?? {}, user);
  }

  @Post('agent-stations/:stationId/claim')
  @RequirePermissions()
  claimAgentJob(@Param('stationId') stationId: string) {
    return this.agent.claim(stationId);
  }

  @Post('agent-jobs/:id/result')
  @RequirePermissions()
  finishAgentJob(@Param('id') id: string, @Body() body: { success?: boolean; error?: string }) {
    return this.agent.finish(id, body?.success === true, body?.error);
  }

  @Get('printer-groups')
  listPrinterGroups(@CurrentUser() user: AuthUser) {
    return this.printers.listPrinterGroups(user);
  }

  @Post('printers')
  upsertPrinter(@Body() body: UpsertPrintPrinterDto, @CurrentUser() user: AuthUser) {
    return this.printers.upsertPrinter(body, user);
  }

  @Get('templates')
  listTemplates(@Query() query: ListLabelTemplatesDto) {
    return this.templates.listTemplates(query);
  }

  @Post('templates')
  createTemplate(@Body() body: CreateLabelTemplateDto) {
    return this.templates.createTemplate(body);
  }

  @Patch('templates/:id')
  updateTemplate(@Param('id') templateId: string, @Body() body: UpdateLabelTemplateDto) {
    return this.templates.updateTemplate(templateId, body);
  }

  @Get('templates/:id/versions')
  listTemplateVersions(@Param('id') templateId: string) {
    return this.templates.listTemplateVersions(templateId);
  }

  @Post('templates/:id/preview')
  previewTemplate(@Param('id') templateId: string, @Body() body: PreviewLabelTemplateDto) {
    return this.templates.previewTemplate(templateId, body);
  }

  @Post('templates/:id/jobs')
  createJobFromTemplate(
    @Param('id') templateId: string,
    @Body() body: CreatePrintJobFromTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.jobs.createFromTemplate(templateId, body, user);
  }

  @Get('jobs')
  listJobs(@Query() query: ListPrintJobsDto, @CurrentUser() user: AuthUser) {
    return this.jobs.listJobs(query, user);
  }

  @Patch('jobs/:id/status')
  updateJobStatus(@Param('id') jobId: string, @Body() body: UpdatePrintJobStatusDto, @CurrentUser() user: AuthUser) {
    return this.jobs.updateStatus(jobId, body, user);
  }

  @Post('jobs/:id/reprint')
  reprintJob(@Param('id') jobId: string, @CurrentUser() user: AuthUser, @Body() body: ReprintPrintJobDto = {}) {
    return this.jobs.reprintJob(jobId, body, user);
  }

  @Post('jobs/process')
  processQueue(@Body() body: ProcessPrintQueueDto = {}, @CurrentUser() user: AuthUser) {
    return this.queue.processQueued(body.limit, user, body.groupCode);
  }

  @Post('box-label/preview')
  previewBoxLabel(@Body() body: PreviewBoxLabelDto) {
    return {
      printerLanguage: 'TSPL',
      tspl: this.labels.boxLabel(body),
    };
  }

  @Post('sku-label/preview')
  previewSkuLabel(@Body() body: PreviewSkuLabelDto) {
    return {
      printerLanguage: 'TSPL',
      tspl: this.labels.skuLabel(body),
    };
  }

  @Post('pallet-label/preview')
  previewPalletLabel(@Body() body: PreviewPalletLabelDto) {
    return {
      printerLanguage: 'TSPL',
      tspl: this.labels.palletLabel(body),
    };
  }
}

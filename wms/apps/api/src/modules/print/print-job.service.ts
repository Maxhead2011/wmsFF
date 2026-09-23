import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { PrinterScopeService } from '../auth/printer-scope.service';
import { CreatePrintJobFromTemplateDto } from './dto/create-print-job.dto';
import { ListPrintJobsDto } from './dto/list-print-jobs.dto';
import { ReprintPrintJobDto } from './dto/reprint-print-job.dto';
import { UpdatePrintJobStatusDto } from './dto/update-print-job-status.dto';
import { LabelTemplateService } from './label-template.service';
import { PrintPrinterService, normalizePrinterCode } from './print-printer.service';

@Injectable()
export class PrintJobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: LabelTemplateService,
    private readonly printers: PrintPrinterService,
    private readonly printerScopes: PrinterScopeService,
  ) {}

  async listJobs(query: ListPrintJobsDto, user: AuthUser) {
    const printerCodes = await this.resolvePrinterCodesForScope(user, query.groupCode);

    return this.prisma.printJob.findMany({
      where: {
        status: query.status,
        printerCode: printerCodes ? { in: printerCodes } : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
    });
  }

  async createFromTemplate(templateId: string, dto: CreatePrintJobFromTemplateDto, user: AuthUser) {
    const printerCode = normalizePrinterCode(dto.printerCode);
    const copies = dto.copies ?? 1;
    const template = await this.templates.getTemplateOrThrow(templateId);
    const printer = await this.printers.getActivePrinterOrThrow(printerCode);
    this.printerScopes.requirePrinterGroupAccess(user, printer.groupCode, 'print');

    if (!template.isActive) {
      throw new BadRequestException('Шаблон этикетки отключен.');
    }

    const variables = dto.variables ?? {};
    // FIX: copies must alter the command sent to the printer, not just job metadata.
    const tspl = applyPrintCopies(this.templates.renderTspl(template.tspl, variables), copies);

    // Русский комментарий: очередь хранит уже готовый TSPL, чтобы будущий печатный воркер не зависел от изменений шаблона.
    return this.prisma.printJob.create({
      data: {
        printerCode,
        labelType: template.type,
        payload: {
          source: 'label-template',
          templateId: template.id,
          templateCode: template.code,
          templateName: template.name,
          templateVersion: template.version,
          variables,
          copies,
        } satisfies Prisma.InputJsonValue,
        tspl,
        status: 'queued',
      },
    });
  }

  async updateStatus(jobId: string, dto: UpdatePrintJobStatusDto, user: AuthUser) {
    const job = await this.prisma.printJob.findUnique({
      where: { id: jobId },
      select: { id: true, payload: true, printerCode: true },
    });

    if (!job) {
      throw new NotFoundException('Задание печати не найдено.');
    }

    const printer = await this.printers.getActivePrinterOrThrow(job.printerCode);
    this.printerScopes.requirePrinterGroupAccess(user, printer.groupCode, 'manage');

    return this.prisma.printJob.update({
      where: { id: jobId },
      data: {
        status: dto.status,
        payload: mergeStatusMessage(job.payload, dto.message),
      },
    });
  }

  async reprintJob(jobId: string, dto: ReprintPrintJobDto, user: AuthUser) {
    const job = await this.prisma.printJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException('Задание печати не найдено.');
    }

    if (job.printerCode.startsWith('AGENT:')) {
      const station = await this.prisma.fbsPrintStation.findFirst({ where: { id: job.printerCode.slice('AGENT:'.length), enabled: true }, select: { id: true } });
      if (!station) throw new BadRequestException('Печатная станция отключена.');
    } else {
      const printer = await this.printers.getActivePrinterOrThrow(job.printerCode);
      this.printerScopes.requirePrinterGroupAccess(user, printer.groupCode, 'print');
    }

    // Русский комментарий: перепечатка создает новое задание, а связь с оригиналом хранится в payload для аудита.
    return this.prisma.printJob.create({
      data: {
        printerCode: job.printerCode,
        labelType: job.labelType,
        payload: reprintPayload(job.payload, job.id, dto.reason),
        tspl: job.tspl,
        status: 'queued',
      },
    });
  }

  private async resolvePrinterCodesForScope(user: AuthUser, requestedGroupCode?: string) {
    const groupCode = this.printerScopes.resolvePrinterGroupFilter(user, requestedGroupCode);
    if (!groupCode) {
      return undefined;
    }

    const printers = await this.prisma.printPrinter.findMany({
      where: { groupCode },
      select: { code: true },
    });

    return printers.map((printer) => printer.code);
  }
}

function mergeStatusMessage(payload: Prisma.JsonValue, message?: string) {
  const currentPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Prisma.JsonObject) : {};

  if (!message?.trim()) {
    return currentPayload;
  }

  return {
    ...currentPayload,
    statusMessage: message.trim(),
  } satisfies Prisma.InputJsonObject;
}

function reprintPayload(payload: Prisma.JsonValue, jobId: string, reason?: string) {
  const currentPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Prisma.JsonObject) : {};
  const trimmedReason = reason?.trim();

  return {
    ...currentPayload,
    reprintOfJobId: jobId,
    reprintReason: trimmedReason || 'Повторная печать',
    reprintedAt: new Date().toISOString(),
  } satisfies Prisma.InputJsonObject;
}

function applyPrintCopies(tspl: string, copies: number) {
  if (!Number.isInteger(copies) || copies < 1 || copies > 100) {
    throw new BadRequestException('Количество копий должно быть от 1 до 100.');
  }
  const normalized = tspl.replace(/\r\n?/g, '\n');
  const command = /^[ \t]*PRINT[ \t]+\d+(?:[ \t]*,[ \t]*\d+)?[ \t]*$/gim;
  const matches = [...normalized.matchAll(command)];
  if (matches.length > 1) throw new BadRequestException('Шаблон содержит несколько команд PRINT.');
  return matches.length ? normalized.replace(command, `PRINT ${copies}`) : `${normalized.trimEnd()}\nPRINT ${copies}`;
}

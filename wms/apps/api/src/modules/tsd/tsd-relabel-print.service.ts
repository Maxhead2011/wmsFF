import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { TsdAssemblyService } from './tsd-assembly.service';
import { buildTsdRelabelLabel } from './tsd-relabel-label';

const RELABEL_SOURCE = 'TSD_RELABEL';

function required(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) {
    throw new BadRequestException(`Укажите ${name}.`);
  }
  return value.trim();
}

@Injectable()
export class TsdRelabelPrintService {
  constructor(private readonly prisma: PrismaService, private readonly assembly: TsdAssemblyService) {}

  async stations(requestId: string, user: AuthUser) {
    await this.assembly.getRequestPlan(requestId, user);
    // FIX: offline stations cannot receive a new print job that might run much later.
    return this.prisma.fbsPrintStation.findMany({
      where: { enabled: true, labelWidthMm: 58, labelHeightMm: 40,
        lastSeenAt: { gt: new Date(Date.now() - 45_000) } },
      select: { id: true, name: true, printerName: true }, orderBy: { name: 'asc' },
    });
  }

  async create(requestId: string, body: Record<string, unknown>, user: AuthUser) {
    const printId = required(body.printId, 'идентификатор печати');
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(printId)) throw new BadRequestException('Неверный идентификатор печати.');
    const stationId = required(body.stationId, 'станцию печати');
    const sourceBox = required(body.sourceBox, 'исходный короб');
    const oldBarcode = required(body.oldBarcode, 'старый ШК');
    const newBarcode = required(body.newBarcode, 'новый ШК');
    const size = typeof body.size === 'string' ? body.size.trim() : '';
    const plan = await this.assembly.getRequestPlan(requestId, user);
    const task = plan.relabelTasks.find(row => row.sourceBox === sourceBox && row.oldBarcode === oldBarcode &&
      row.newBarcode === newBarcode && (row.size ?? '') === size && row.remainingQuantity > 0);
    if (!task) throw new ConflictException('Задание переклейки изменилось. Обновите заявку и отсканируйте исходный товар.');
    const prior = await this.prisma.fbsPrintJob.findUnique({ where: { historyId: printId } });
    if (prior) return this.ownedStatus(prior, requestId, stationId, newBarcode, user);

    const station = await this.prisma.fbsPrintStation.findFirst({ where: {
      id: stationId, enabled: true, labelWidthMm: 58, labelHeightMm: 40,
      lastSeenAt: { gt: new Date(Date.now() - 45_000) },
    } });
    if (!station) throw new ConflictException('Печатная станция не на связи или её формат не 58 × 40 мм.');
    const products = await this.prisma.sku.findMany({ where: {
      clientId: plan.client.id, barcodes: { some: { value: newBarcode } },
    }, select: { id: true, name: true, article: true, color: true, size: true, brand: true }, take: 2 });
    if (products.length !== 1) throw new ConflictException('Целевой ШК не соответствует одной карточке клиента. Проверьте соответствие переклейки.');
    const imageBase64 = await buildTsdRelabelLabel(newBarcode, products[0], plan.client.name);
    const request = await this.prisma.clientRequest.findUniqueOrThrow({ where: { id: requestId }, select: { number: true } });
    try {
      const job = await this.prisma.$transaction(async tx => {
        const created = await tx.fbsPrintJob.create({ data: {
          stationId, historyId: printId, assemblyId: requestId, requestId,
          requestNumber: request.number, orderId: `RELABEL:${request.number}`,
          kiz: newBarcode, warehouseName: plan.client.name, productName: products[0].name,
          stickerCode: newBarcode, stickerMime: 'image/png', stickerBase64: imageBase64,
          source: RELABEL_SOURCE, requestedById: user.id, requestedBy: user.name,
          deviceCode: user.deviceCode ?? null,
        } });
        await tx.auditLog.create({ data: { userId: user.id, action: 'TSD_RELABEL_TWO_LABELS_QUEUED',
          entity: 'FbsPrintJob', entityId: created.id,
          payload: { requestId, stationId, sourceBox, oldBarcode, newBarcode, size, copies: 2 } } });
        return created;
      });
      return this.ownedStatus(job, requestId, stationId, newBarcode, user);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const existing = await this.prisma.fbsPrintJob.findUnique({ where: { historyId: printId } });
      if (!existing) throw error;
      return this.ownedStatus(existing, requestId, stationId, newBarcode, user);
    }
  }

  async status(requestId: string, printId: string, user: AuthUser) {
    await this.assembly.getRequestPlan(requestId, user);
    const job = await this.prisma.fbsPrintJob.findUnique({ where: { historyId: printId } });
    if (!job || job.source !== RELABEL_SOURCE || job.requestId !== requestId || job.requestedById !== user.id) {
      throw new NotFoundException('Задание переклейки не найдено.');
    }
    return { printId, status: job.status, stationId: job.stationId, barcode: job.stickerCode,
      error: job.errorMessage, printedAt: job.printedAt };
  }

  private ownedStatus(job: { source: string; requestId: string; requestedById: string; stationId: string;
    stickerCode: string | null; historyId: string; status: string; errorMessage: string | null; printedAt: Date | null },
    requestId: string, stationId: string, barcode: string, user: AuthUser) {
    if (job.source !== RELABEL_SOURCE || job.requestId !== requestId || job.stationId !== stationId ||
      job.stickerCode !== barcode || job.requestedById !== user.id) {
      throw new ConflictException('Этот идентификатор уже использован для другой печати.');
    }
    return { printId: job.historyId, status: job.status, stationId, barcode,
      error: job.errorMessage, printedAt: job.printedAt };
  }
}

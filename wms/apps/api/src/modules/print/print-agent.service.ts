import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';

type AgentLabelInput = {
  stationId?: string;
  skuId?: string;
  barcode?: string;
  imageBase64?: string;
  copies?: number;
  widthMm?: number;
  heightMm?: number;
  clientId?: string;
  value?: string;
};

const agentPrinterCode = (stationId: string) => `AGENT:${stationId}`;

@Injectable()
export class PrintAgentService {
  constructor(private readonly prisma: PrismaService, private readonly clientScopes: ClientScopeService) {}

  // FIX: reuse the working FBS print stations without changing their FBS queue.
  async listStations() {
    // FIX: hide abandoned agent sessions in label-print selectors; preserve stations and queued jobs.
    const recentlySeen = new Date(Date.now() - 2 * 60_000);
    return this.prisma.fbsPrintStation.findMany({
      where: { enabled: true, lastSeenAt: { gte: recentlySeen } },
      orderBy: [{ lastSeenAt: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, printerName: true, printerModel: true, lastSeenAt: true },
    });
  }

  async createSkuJob(input: AgentLabelInput, user: AuthUser) {
    const stationId = input.stationId?.trim();
    const skuId = input.skuId?.trim();
    const barcode = input.barcode?.trim();
    const copies = input.copies ?? 1;
    if (!stationId || !skuId || !barcode) throw new BadRequestException('Укажите станцию, товар и штрихкод.');
    if (!Number.isInteger(copies) || copies < 1 || copies > 100) throw new BadRequestException('Количество этикеток — от 1 до 100.');
    // FIX: accept only the two reviewed marketplace label stocks; validate the PNG against the chosen size.
    if (!((input.widthMm === 60 && input.heightMm === 40) || (input.widthMm === 40 && input.heightMm === 30))) {
      throw new BadRequestException('Этикетка товара должна быть 60 × 40 или 40 × 30 мм (ширина × высота).');
    }
    const station = await this.prisma.fbsPrintStation.findFirst({ where: { id: stationId, enabled: true }, select: { id: true } });
    if (!station) throw new NotFoundException('Печатная станция не найдена или отключена.');
    const sku = await this.prisma.sku.findFirst({
      where: { id: skuId, clientId: this.clientScopes.resolveClientFilter(user) },
      select: { id: true, clientId: true, name: true, barcodes: { select: { value: true } } },
    });
    if (!sku || !sku.barcodes.some(item => item.value === barcode)) throw new BadRequestException('Штрихкод не найден в доступной карточке товара.');
    const image = readPng(input.imageBase64, input.widthMm, input.heightMm);
    return this.prisma.printJob.create({
      data: {
        printerCode: agentPrinterCode(stationId), labelType: 'SKU', status: 'queued', tspl: 'IMAGE/PNG',
        payload: { source: 'SKU_AGENT', skuId, clientId: sku.clientId, barcode, imageBase64: image, copies, widthMm: input.widthMm, heightMm: input.heightMm, requestedById: user.id },
      },
      select: { id: true, status: true, printerCode: true, createdAt: true },
    });
  }

  // FIX: serial box labels use the same physical Windows stations as SKU labels.
  async createCustomJob(input: AgentLabelInput, user: AuthUser) {
    const stationId = input.stationId?.trim();
    const clientId = input.clientId?.trim();
    if (!stationId || !clientId) throw new BadRequestException('Укажите станцию и клиента.');
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const copies = input.copies ?? 1;
    if (!Number.isInteger(copies) || copies < 1 || copies > 100) throw new BadRequestException('Количество этикеток — от 1 до 100.');
    if (!Number.isInteger(input.widthMm) || !Number.isInteger(input.heightMm) || input.widthMm! < 20 || input.widthMm! > 150 || input.heightMm! < 20 || input.heightMm! > 150) throw new BadRequestException('Размер этикетки — от 20 до 150 мм.');
    const [station, client] = await Promise.all([
      this.prisma.fbsPrintStation.findFirst({ where: { id: stationId, enabled: true }, select: { id: true } }),
      this.prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }),
    ]);
    if (!station) throw new NotFoundException('Печатная станция не найдена или отключена.');
    if (!client) throw new BadRequestException('Клиент недоступен.');
    const image = readPng(input.imageBase64, input.widthMm!, input.heightMm!);
    return this.prisma.printJob.create({
      data: { printerCode: agentPrinterCode(stationId), labelType: 'CUSTOM', status: 'queued', tspl: 'IMAGE/PNG',
        payload: { source: 'CUSTOM_AGENT', clientId, value: String(input.value ?? '').slice(0, 120), imageBase64: image, copies, widthMm: input.widthMm, heightMm: input.heightMm, requestedById: user.id } },
      select: { id: true, status: true, printerCode: true, createdAt: true },
    });
  }

  async claim(stationId: string) {
    const station = await this.prisma.fbsPrintStation.findFirst({ where: { id: stationId, enabled: true }, select: { id: true } });
    if (!station) throw new NotFoundException('Печатная станция не найдена или отключена.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const stale = new Date(Date.now() - 30 * 60_000);
      const job = await this.prisma.printJob.findFirst({ where: { printerCode: agentPrinterCode(stationId), OR: [{ status: 'queued' }, { status: 'sent', processedAt: { lt: stale } }] }, orderBy: { createdAt: 'asc' } });
      if (!job) return null;
      const claimed = await this.prisma.printJob.updateMany({ where: { id: job.id, status: job.status, processedAt: job.processedAt }, data: { status: 'sent', attempts: { increment: 1 }, processedAt: new Date() } });
      if (claimed.count) {
        const payload = job.payload as Record<string, unknown>;
        return { id: job.id, imageBase64: payload.imageBase64, copies: payload.copies, widthMm: payload.widthMm, heightMm: payload.heightMm };
      }
    }
    return null;
  }

  async finish(jobId: string, success: boolean, error: unknown) {
    const job = await this.prisma.printJob.findFirst({ where: { id: jobId, printerCode: { startsWith: 'AGENT:' }, status: 'sent' }, select: { id: true, payload: true } });
    if (!job) throw new NotFoundException('Задание печати не найдено или уже завершено.');
    const payload = job.payload as Record<string, unknown>;
    return this.prisma.printJob.update({ where: { id: jobId }, data: { status: success ? 'printed' : 'failed', processedAt: new Date(), payload: { ...payload, result: success ? 'printed' : 'failed', error: success ? null : String(error ?? 'Ошибка принтера').slice(0, 500) } }, select: { id: true, status: true } });
  }
}

function readPng(value: unknown, widthMm: number, heightMm: number) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 1_500_000) throw new BadRequestException('Передайте PNG-изображение этикетки размером до 1 МБ.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new BadRequestException('Некорректное PNG-изображение этикетки.');
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  if (width < 200 || width > 2000 || height < 200 || height > 3000) throw new BadRequestException('Неверный размер изображения этикетки.');
  if (Math.abs(width / height - widthMm / heightMm) > 0.08) throw new BadRequestException('Пропорции изображения не совпадают с размером этикетки.');
  return value;
}

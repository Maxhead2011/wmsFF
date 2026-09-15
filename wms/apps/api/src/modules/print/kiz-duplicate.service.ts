import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { parseDuplicateKiz } from './kiz-duplicate-code';
import { buildKizDuplicateLabel } from './kiz-duplicate-label';

type Lookup = { clientId?: unknown; kiz?: unknown; barcode?: unknown };
type Print = Lookup & { id?: unknown; skuId?: unknown; stationId?: unknown; deviceCode?: unknown };
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const text = (v: unknown, name: string, max = 150) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new BadRequestException(`Неверное поле ${name}.`);
  return v.trim();
};
const productSelect = { id: true, name: true, article: true, size: true, color: true, barcodes: { select: { value: true } } };

@Injectable()
export class KizDuplicateService {
  constructor(private readonly prisma: PrismaService) {}

  private enabled() {
    if (process.env.WMS_KIZ_DUPLICATE_ENABLED !== 'true') throw new NotFoundException('Дубль КИЗ пока не включён.');
  }
  private warehouse(user: AuthUser) {
    this.enabled();
    if (!user.permissionCodes.some(p => ['print:write', 'system:admin'].includes(p))) throw new ForbiddenException('Нет права печати этикеток.');
    if (!user.activeWarehouseId) throw new BadRequestException('Выберите свой филиал в ВМС и войдите повторно.');
    return user.activeWarehouseId;
  }
  async clients(user: AuthUser) {
    const warehouseId = this.warehouse(user);
    const global = user.permissionCodes.includes('system:admin') || user.clientScopeMode === 'ALL';
    const branchStaff = user.roleCodes.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'TSD', 'BRANCH_MANAGER'].includes(role.toUpperCase()));
    const rows = await this.prisma.warehouseClient.findMany({ where: { warehouseId,
      ...(global || branchStaff && user.clientIds.length === 0 ? {} : { clientId: { in: user.clientIds } }),
    }, select: { clientId: true, client: { select: { name: true, status: true } } } });
    return rows.filter(r => !user.hiddenClientIds?.includes(r.clientId) && r.client.status === 'ACTIVE')
      .map(r => ({ id: r.clientId, name: r.client.name }));
  }
  private async authorizeClient(clientId: string, user: AuthUser) {
    if (!(await this.clients(user)).some(c => c.id === clientId)) throw new ForbiddenException('Нет доступа к клиенту в этом филиале.');
  }

  // FIX: exact identity first; a shared GTIN never silently chooses an arbitrary SKU.
  private async candidates(clientId: string, prefix: string) {
    const escaped = prefix.replace(/[\\%_]/g, '\\$&') + '%';
    const scannerPrefix = ']d2' + escaped;
    return this.prisma.$queryRaw<Array<{ skuId: string }>>(Prisma.sql`
      SELECT DISTINCT "skuId" FROM (
        SELECT "skuId" FROM "ProductMark" WHERE "clientId"=${clientId} AND (value LIKE ${escaped} OR value LIKE ${scannerPrefix})
        UNION ALL SELECT "skuId" FROM "FbsTsdAssembly" WHERE "clientId"=${clientId} AND (kiz LIKE ${escaped} OR kiz LIKE ${scannerPrefix})
        UNION ALL SELECT "skuId" FROM "ShippedKizHistory" WHERE "clientId"=${clientId} AND (kiz LIKE ${escaped} OR kiz LIKE ${scannerPrefix})
        UNION ALL SELECT "taskSnapshot"->>'skuId' AS "skuId" FROM "FbsAssemblyAttemptHistory" WHERE "clientId"=${clientId} AND (kiz LIKE ${escaped} OR kiz LIKE ${scannerPrefix})
      ) AS candidates WHERE "skuId" IS NOT NULL
    `);
  }
  async lookup(body: Lookup, user: AuthUser) {
    const clientId = text(body.clientId, 'clientId');
    await this.authorizeClient(clientId, user);
    const parsed = parseDuplicateKiz(body.kiz);
    const exact = await this.candidates(clientId, parsed.identity + '\u001d');
    const candidates = exact.length ? exact : await this.candidates(clientId, '01' + parsed.gtin + '21');
    const barcode = body.barcode === undefined ? null : text(body.barcode, 'barcode', 80);
    let products: Array<Prisma.SkuGetPayload<{ select: typeof productSelect }>>;
    if (barcode) {
      products = await this.prisma.sku.findMany({ where: { clientId, barcodes: { some: { value: barcode } } }, select: productSelect, take: 2 });
      if (products.length !== 1) throw new BadRequestException('ШК не найден у выбранного клиента или соответствует нескольким товарам.');
      // FIX: GTIN history does not bind an unknown serial number to a SKU.
      // The scanned barcode supplies its caption; an exact KIZ binding still wins.
      if (exact.length && !exact.some(c => c.skuId === products[0].id)) {
        throw new ConflictException('Этот КИЗ уже привязан в ВМС к другому товару. Проверьте вещь и этикетку.');
      }
    } else {
      products = candidates.length === 1
        ? await this.prisma.sku.findMany({ where: { clientId, id: candidates[0].skuId }, select: productSelect }) : [];
    }
    return { clientId, kiz: parsed.raw, gtin: parsed.gtin, identity: parsed.identity,
      state: products.length === 1 ? 'READY' : 'NEED_BARCODE', product: products[0] ?? null,
      match: barcode ? 'BARCODE_CONFIRMED' : exact.length ? 'EXACT_KIZ' : 'GTIN',
      message: products.length === 1 ? 'Проверьте товар, размер и цвет перед печатью.' :
        candidates.length > 1 ? 'По КИЗ/GTIN найдено несколько товаров. Отсканируйте ШК.' : 'КИЗ не привязан к товару в ВМС. Отсканируйте ШК товара.',
    };
  }

  async stations(user: AuthUser) {
    const warehouseId = this.warehouse(user);
    const capabilities = await this.prisma.kizDuplicatePrinter.findMany({ where: { warehouseId, lastSeenAt: { gt: new Date(Date.now() - 45_000) } } });
    return this.prisma.fbsPrintStation.findMany({ where: { id: { in: capabilities.map(c => c.stationId) }, enabled: true, labelWidthMm: 58, labelHeightMm: 40 },
      select: { id: true, name: true, printerModel: true }, orderBy: { name: 'asc' } });
  }
  async create(body: Print, user: AuthUser) {
    const warehouseId = this.warehouse(user), id = text(body.id, 'id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('Неверный идентификатор печати.');
    const clientId = text(body.clientId, 'clientId'), stationId = text(body.stationId, 'stationId'), skuId = text(body.skuId, 'skuId');
    const deviceCode = text(body.deviceCode, 'deviceCode');
    await this.authorizeClient(clientId, user);
    const kiz = parseDuplicateKiz(body.kiz).raw;
    const fingerprint = createHash('sha256').update(JSON.stringify([user.id, warehouseId, clientId, skuId, stationId, kiz, body.barcode ?? null])).digest('hex');
    const prior = await this.prisma.kizDuplicateJob.findUnique({ where: { id } });
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ConflictException('Идентификатор уже использован для другой печати.');
      return this.status(id, user);
    }
    if (!(await this.stations(user)).some(s => s.id === stationId)) throw new ConflictException('Станция недоступна. Нужен обновлённый агент и этикетки 58 × 40 мм.');
    const resolved = await this.lookup(body, user);
    if (resolved.state !== 'READY' || resolved.product?.id !== skuId) throw new ConflictException('Карточка товара изменилась. Отсканируйте КИЗ заново.');
    const imageBase64 = await buildKizDuplicateLabel(kiz, resolved.product);
    try {
      await this.prisma.$transaction(async tx => {
        await tx.kizDuplicateJob.create({ data: { id, fingerprint, stationId, warehouseId, clientId, skuId, kiz, deviceCode,
          product: json({ ...resolved.product, match: resolved.match }), imageBase64, requestedById: user.id, requestedBy: user.name } });
        await tx.auditLog.create({ data: { userId: user.id, action: 'KIZ_DUPLICATE_QUEUED', entity: 'KizDuplicateJob', entityId: id,
          payload: { clientId, warehouseId, skuId, stationId, kiz, deviceCode, match: resolved.match, stockChanged: false, wbChanged: false } } });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const existing = await this.prisma.kizDuplicateJob.findUnique({ where: { id } });
      if (existing?.fingerprint !== fingerprint) throw new ConflictException('Идентификатор печати уже занят.');
    }
    return this.status(id, user);
  }
  async status(id: string, user: AuthUser) {
    const warehouseId = this.warehouse(user);
    const job = await this.prisma.kizDuplicateJob.findUnique({ where: { id } });
    if (!job || job.warehouseId !== warehouseId || job.requestedById !== user.id) throw new NotFoundException('Задание печати не найдено.');
    await this.authorizeClient(job.clientId, user);
    return { id: job.id, status: job.status, product: job.product, createdAt: job.createdAt, printedAt: job.printedAt,
      verifiedAt: job.verifiedAt, error: job.errorMessage,
      checkPrinter: job.status === 'CLAIMED' && !!job.claimedAt && Date.now() - job.claimedAt.getTime() > 120_000 };
  }
  async history(user: AuthUser) {
    const warehouseId = this.warehouse(user);
    const clientIds = (await this.clients(user)).map(c => c.id);
    return this.prisma.kizDuplicateJob.findMany({ where: { warehouseId, requestedById: user.id, clientId: { in: clientIds } }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, status: true, product: true, createdAt: true, printedAt: true, verifiedAt: true } });
  }
  async verify(id: string, raw: unknown, user: AuthUser) {
    await this.status(id, user);
    const kiz = parseDuplicateKiz(raw).raw;
    return this.prisma.$transaction(async tx => {
      const job = await tx.kizDuplicateJob.findUniqueOrThrow({ where: { id } });
      if (!['PRINTED', 'VERIFIED'].includes(job.status)) throw new ConflictException('Сначала дождитесь подтверждения печати от станции.');
      if (job.kiz !== kiz) throw new ConflictException('Отсканированный код не совпадает с оригиналом.');
      if (job.status === 'VERIFIED') return { id, status: 'VERIFIED' };
      const changed = await tx.kizDuplicateJob.updateMany({ where: { id, status: 'PRINTED' }, data: { status: 'VERIFIED', verifiedAt: new Date() } });
      if (changed.count) await tx.auditLog.create({ data: { userId: user.id, action: 'KIZ_DUPLICATE_VERIFIED', entity: 'KizDuplicateJob', entityId: id } });
      return { id, status: 'VERIFIED' };
    });
  }
  // FIX: only updated agents poll this separate queue; old agents cannot print a wrong pair.
  async heartbeat(stationId: string, user: AuthUser) {
    const warehouseId = this.warehouse(user);
    const station = await this.prisma.fbsPrintStation.findFirst({ where: { id: stationId, enabled: true, labelWidthMm: 58, labelHeightMm: 40 } });
    if (!station) throw new NotFoundException('Нужна станция печати 58 × 40 мм.');
    const prior = await this.prisma.kizDuplicatePrinter.findUnique({ where: { stationId } });
    if (prior && (prior.warehouseId !== warehouseId || prior.agentUserId !== user.id)) throw new ForbiddenException('Станция закреплена за другим филиалом или пользователем агента.');
    await this.prisma.kizDuplicatePrinter.upsert({ where: { stationId }, create: { stationId, warehouseId, agentUserId: user.id }, update: { lastSeenAt: new Date() } });
    return { ready: true };
  }
  private async authorizeAgent(stationId: string, user: AuthUser) {
    const warehouseId = this.warehouse(user);
    const station = await this.prisma.kizDuplicatePrinter.findUnique({ where: { stationId } });
    if (!station || station.agentUserId !== user.id || station.warehouseId !== warehouseId) throw new ForbiddenException('Нет доступа к очереди станции.');
  }
  async claim(stationId: string, user: AuthUser) {
    await this.authorizeAgent(stationId, user);
    return this.prisma.$transaction(async tx => {
      // TEST: row lock + SKIP LOCKED; uncertain physical prints are never automatically retried.
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "KizDuplicateJob" WHERE "stationId"=${stationId} AND status='QUEUED' ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!rows.length) return null;
      const job = await tx.kizDuplicateJob.update({ where: { id: rows[0].id }, data: { status: 'CLAIMED', claimedAt: new Date(), claimedById: user.id } });
      return { id: job.id, imageBase64: job.imageBase64, contentType: 'image/png', widthMm: 58, heightMm: 40 };
    });
  }
  async finish(stationId: string, id: string, success: unknown, error: unknown, user: AuthUser) {
    await this.authorizeAgent(stationId, user);
    if (typeof success !== 'boolean') throw new BadRequestException('Неверный результат печати.');
    return this.prisma.$transaction(async tx => {
      const job = await tx.kizDuplicateJob.findUnique({ where: { id } });
      if (!job || job.stationId !== stationId || job.claimedById !== user.id) throw new NotFoundException('Задание не выдавалось этому агенту.');
      if (['PRINTED', 'VERIFIED', 'FAILED'].includes(job.status)) return { id, status: job.status };
      if (job.status !== 'CLAIMED') throw new ConflictException('Задание не принято в печать.');
      const status = success ? 'PRINTED' : 'FAILED';
      const changed = await tx.kizDuplicateJob.updateMany({ where: { id, status: 'CLAIMED' }, data: { status, printedAt: success ? new Date() : null, errorMessage: success ? null : String(error || 'Ошибка печати').slice(0, 500) } });
      if (!changed.count) return { id, status: (await tx.kizDuplicateJob.findUniqueOrThrow({ where: { id } })).status };
      await tx.auditLog.create({ data: { userId: user.id, action: 'KIZ_DUPLICATE_' + status, entity: 'KizDuplicateJob', entityId: id, payload: { stationId } } });
      return { id, status };
    });
  }
}

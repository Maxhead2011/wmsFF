import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { MarketplaceConnectionsService } from './marketplace-connections.service';
import { canSubstituteSize, preferredReplacements, replacementDistance, sizeSubstitutionEnabled } from './fbs-size-substitution';
import type { CreateSizeSubstitutionDto, PreviewSizeSubstitutionDto } from './dto/fbs-size-substitution.dto';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
type Approval = { requestId: string; sourceSkuId: string };

@Injectable()
export class FbsSizeSubstitutionService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService,
    private readonly connections: MarketplaceConnectionsService) {}

  capabilities(user: AuthUser) { return { enabled: sizeSubstitutionEnabled() && canSubstituteSize(user) }; }

  private authorize(dto: PreviewSizeSubstitutionDto, user: AuthUser) {
    if (!this.capabilities(user).enabled) throw new ForbiddenException('Замены доступны только администратору и собственнику.');
    this.scopes.requireClientAccess(user, dto.clientId, 'write');
    const warehouseId = user.activeWarehouseId;
    if (!warehouseId || !user.writableWarehouseIds?.includes(warehouseId)) throw new ForbiddenException('Выберите свой доступный филиал.');
    if (!/^\d{1,20}$/.test(dto.orderId)) throw new BadRequestException('Введите номер заказа WB.');
    return warehouseId;
  }

  private async task(db: Prisma.TransactionClient, dto: PreviewSizeSubstitutionDto, warehouseId: string) {
    const rows = await db.fbsTsdAssembly.findMany({ where: { clientId: dto.clientId, orderId: dto.orderId, marketplace: 'WILDBERRIES' } });
    const matches = [];
    for (const task of rows) {
      const request = await db.clientRequest.findFirst({ where: { id: task.requestId, warehouseId } });
      if (request) matches.push({ task, request });
    }
    if (matches.length !== 1) throw new BadRequestException('Не найден единственный заказ WB в выбранном филиале.');
    return matches[0];
  }

  private async approved(db: Prisma.TransactionClient, taskId: string, clientId: string, warehouseId: string) {
    return (await db.$queryRaw<Approval[]>`SELECT "requestId", "sourceSkuId" FROM "FbsSizeSubstitution"
      WHERE "taskId"=${taskId} AND "clientId"=${clientId} AND "warehouseId"=${warehouseId}`)[0];
  }

  private async plan(db: Prisma.TransactionClient, dto: PreviewSizeSubstitutionDto, warehouseId: string) {
    const { task, request } = await this.task(db, dto, warehouseId);
    if (!['RESERVED', 'WAITING_STOCK'].includes(task.status) || task.kiz || task.barcode || task.sourceBarcode || task.completedAt || task.boxId || task.cargoPackingId ||
        task.stickerBarcode || task.stickerPartA || task.stickerPartB || task.sourceBoxPending || task.relabelConfirmedAt || task.cargoPackedAt || task.marketplaceSubmittedAt) {
      throw new ConflictException('Заказ уже начали собирать или он завершён. Замена без повторного списания недоступна.');
    }
    if (!['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'IN_WORK'].includes(request.status) || task.itemCount !== 1) throw new ConflictException('Нужен действующий поштучный заказ.');
    const link = await db.fbsOrderRequestLink.findFirst({ where: { clientId: dto.clientId, connectionId: task.connectionId,
      marketplace: 'WILDBERRIES', orderId: dto.orderId, requestId: task.requestId } });
    if (!link || link.syncStatus !== 'ACTIVE') throw new ConflictException('Привязка заказа изменилась.');
    const physicalProof = await db.stockMovement.findFirst({ where: { clientId: dto.clientId, quantity: { lt: 0 }, idempotencyKey: { contains: task.id } }, select: { id: true } });
    const shipment = await db.wbOrderShipment.findUnique({ where: { assemblyId: task.id }, select: { id: true } });
    if (physicalProof || shipment) throw new ConflictException('У попытки уже есть списание или подтверждение отгрузки. Нужна проверка истории.');
    const skus = await db.sku.findMany({ where: { clientId: dto.clientId, isDraft: false }, include: { barcodes: true } });
    const client = await db.client.findUniqueOrThrow({ where: { id: dto.clientId } });
    if (client.isDemo) throw new ForbiddenException('Демонстрационный клиент недоступен.');
    const mappings = client.relabelingEnabled ? await db.clientArticleMapping.findMany({ where: { clientId: dto.clientId } }) : [];
    const target = skus.find(row => row.id === task.skuId);
    if (!target || !target.barcodes.length) throw new BadRequestException('Нет карточки или баркода целевого товара.');
    const sources = skus.flatMap(source => {
      const distance = replacementDistance(target, source, mappings);
      return distance === null || !source.barcodes.length ? [] : [{ source, distance }];
    });
    const balances = await db.stockBalance.findMany({ where: { clientId: dto.clientId, warehouseId,
      skuId: { in: sources.map(row => row.source.id) }, status: 'AVAILABLE', quantity: { gt: 0 }, boxId: { not: null },
      box: { clientId: dto.clientId, warehouseId, status: 'active', storagePlacement: { pallet: { clientId: dto.clientId, warehouseId } } } },
      include: { box: { include: { storagePlacement: { include: { pallet: true } } } } }, orderBy: { id: 'asc' } });
    const reservations = await this.connections.repeatAssemblyStockReservations(dto.clientId, sources.map(row => row.source.id), db);
    const candidates = preferredReplacements(sources.map(({ source, distance }) => {
      const boxes = new Map<string, { id: string; code: string; pallet: string; available: number }>();
      for (const balance of balances.filter(row => row.skuId === source.id)) {
        const box = boxes.get(balance.boxId!) ?? { id: balance.boxId!, code: balance.box!.code,
          pallet: balance.box!.storagePlacement!.pallet.code, available: 0 };
        box.available += balance.quantity; boxes.set(box.id, box);
      }
      for (const box of boxes.values()) box.available = Math.max(0, box.available - (reservations.get(source.id) ?? [])
        .filter(row => row.boxId === box.id && row.taskId !== task.id).reduce((sum, row) => sum + row.itemCount, 0));
      const availableBoxes = [...boxes.values()].filter(box => box.available > 0);
      return { source, distance, boxes: availableBoxes, available: availableBoxes.reduce((sum, box) => sum + box.available, 0) };
    }));
    const previewToken = createHash('sha256').update(JSON.stringify([task, link, target, candidates])).digest('hex');
    return { task, request, link, target, candidates, previewToken };
  }

  private async wb(dto: PreviewSizeSubstitutionDto, connectionId: string, user: AuthUser) {
    const status = (await this.connections.readRepeatAssemblyWbStatuses(dto.clientId, connectionId, [dto.orderId], user)).get(dto.orderId);
    if (!status || !['new', 'confirm', 'complete'].includes(status.supplierStatus) || status.wbStatus !== 'waiting') {
      throw new ConflictException('WB не подтверждает ожидающий заказ. Отменённые и полученные покупателем заказы не заменяем.');
    }
    return status;
  }

  async preview(dto: PreviewSizeSubstitutionDto, user: AuthUser) {
    const warehouseId = this.authorize(dto, user);
    const { task } = await this.task(this.prisma, dto, warehouseId);
    const previous = await this.approved(this.prisma, task.id, dto.clientId, warehouseId);
    if (previous) return { existingRequest: await this.prisma.clientRequest.findUnique({ where: { id: previous.requestId }, select: { id: true, number: true } }), options: [] };
    const wbStatus = await this.wb(dto, task.connectionId, user);
    return this.prisma.$transaction(async db => {
      const plan = await this.plan(db, dto, warehouseId);
      const product = (sku: typeof plan.target) => ({ id: sku.id, name: sku.name, article: sku.article, color: sku.color, size: sku.size, barcodes: sku.barcodes.map(row => row.value) });
      return { taskId: task.id, orderId: dto.orderId, target: product(plan.target), previewToken: plan.previewToken,
        warning: wbStatus.supplierStatus === 'complete' ? 'В WB заказ уже в доставке, но эта попытка в ВМС не отобрана. Будет создана локальная сборка с заменой; статус WB не меняется.' : null,
        options: plan.candidates.map(row => ({ ...product(row.source), distance: row.distance, available: row.available, boxes: row.boxes })) };
    }, { isolationLevel: 'RepeatableRead', timeout: 30_000 });
  }

  async create(dto: CreateSizeSubstitutionDto, user: AuthUser) {
    const warehouseId = this.authorize(dto, user);
    if (dto.confirmRelabel !== true) throw new BadRequestException('Подтвердите замену и переклейку.');
    const { task } = await this.task(this.prisma, dto, warehouseId);
    if (task.id !== dto.taskId) throw new ConflictException('Попытка сборки изменилась.');
    const existing = await this.approved(this.prisma, dto.taskId, dto.clientId, warehouseId);
    if (existing) {
      if (existing.sourceSkuId !== dto.sourceSkuId) throw new ConflictException('Для заказа уже согласована другая замена.');
      return this.prisma.clientRequest.findUniqueOrThrow({ where: { id: existing.requestId }, select: { id: true, number: true } });
    }
    await this.wb(dto, task.connectionId, user);
    const checkedAt = Date.now();
    const created = await this.prisma.$transaction(async db => {
      // FIX: serializable retry fails closed; selection is re-read inside the write transaction.
      await db.$queryRaw`SELECT "id" FROM "FbsTsdAssembly" WHERE "id"=${dto.taskId} FOR UPDATE`;
      const previous = await this.approved(db, dto.taskId, dto.clientId, warehouseId);
      if (previous) {
        if (previous.sourceSkuId !== dto.sourceSkuId) throw new ConflictException('Для заказа уже согласована другая замена.');
        return db.clientRequest.findUniqueOrThrow({ where: { id: previous.requestId }, select: { id: true, number: true } });
      }
      const plan = await this.plan(db, dto, warehouseId);
      if (Date.now() - checkedAt > 60_000 || plan.previewToken !== dto.previewToken) throw new ConflictException('Заказ или остатки изменились. Повторите подбор.');
      const option = plan.candidates.find(row => row.source.id === dto.sourceSkuId);
      if (!option) throw new ConflictException('Выбранная замена больше недоступна.');
      const box = option.boxes[0];
      const now = new Date();
      const instructions = `Замена размера по заказу WB ${dto.orderId}. Отобрать ${option.source.article}: ${option.source.size}, ШК ${option.source.barcodes.map(b => b.value).join(', ')}. ` +
        `Переклеить на ${plan.target.article}: ${plan.target.size}, ШК ${plan.target.barcodes.map(b => b.value).join(', ')}. Списать исходный товар только при фактическом отборе.`;
      const request = await db.clientRequest.create({ data: { clientId: dto.clientId, warehouseId, type: 'OUTBOUND', status: 'IN_WORK',
        title: `Замена размера WB №${dto.orderId}`, comment: instructions, createdByUserId: user.id,
        fbsEmergencyAssemblyAt: now, fbsEmergencyAssemblyByUserId: user.id, fbsEmergencyAssemblyByName: user.name,
        items: { create: { skuId: plan.target.id, name: plan.target.name, quantity: 1, barcode: plan.target.barcodes[0].value, comment: instructions } } }, include: { items: true } });
      const changed = await db.fbsTsdAssembly.updateMany({ where: { id: task.id, updatedAt: plan.task.updatedAt, requestId: plan.task.requestId }, data: {
        requestId: request.id, requestItemId: request.items[0].id, stockWarehouseId: warehouseId,
        sourceSkuId: option.source.id, sourceProductName: option.source.name, sourceArticle: option.source.article,
        sourceBarcodes: option.source.barcodes.map(b => b.value), relabelRequired: true, relabelConfirmedAt: null,
        reservedBoxId: box.id, reservedBoxCode: box.code, reservedAt: now, status: 'RESERVED',
        deviceCode: 'AUTO', workerUserId: null, workerName: null, startedAt: null,
        storageBoxes: option.boxes.map(b => ({ code: b.code, quantity: b.available, status: 'AVAILABLE' })), errorMessage: null } });
      if (changed.count !== 1) throw new ConflictException('Сборка изменилась. Заявка не создана.');
      await db.fbsOrderRequestLink.update({ where: { id: plan.link.id }, data: { requestId: request.id, syncStatus: 'ACTIVE', syncIssue: null } });
      // FIX: remove the old order's contribution rather than leaving a second pick instruction.
      const reduced = await db.clientRequestItem.updateMany({ where: { id: plan.task.requestItemId, requestId: plan.task.requestId, quantity: { gte: 1 } }, data: { quantity: { decrement: 1 } } });
      if (reduced.count !== 1) throw new ConflictException('Количество в исходной заявке изменилось.');
      if (plan.task.reservedBoxId) {
        await db.clientRequestBoxSelection.updateMany({ where: { requestItemId: plan.task.requestItemId, boxId: plan.task.reservedBoxId, quantity: { gte: 1 } }, data: { quantity: { decrement: 1 } } });
      }
      await db.clientRequestBoxSelection.create({ data: { requestItemId: request.items[0].id, skuId: option.source.id, boxId: box.id, quantity: 1 } });
      await db.$executeRaw`INSERT INTO "FbsSizeSubstitution" ("taskId","clientId","warehouseId","requestId","sourceSkuId","targetSkuId","approvedByUserId")
        VALUES (${task.id},${dto.clientId},${warehouseId},${request.id},${option.source.id},${plan.target.id},${user.id})`;
      await db.auditLog.create({ data: { userId: user.id, action: 'FBS_SIZE_SUBSTITUTION_CREATED', entity: 'ClientRequest', entityId: request.id,
        payload: json({ oldTask: plan.task, oldLink: plan.link, sourceSkuId: option.source.id, targetSkuId: plan.target.id, instructions }) } });
      await db.clientRequestEvent.create({ data: { requestId: request.id, clientId: dto.clientId, eventType: 'CREATED', title: 'Сборка с заменой размера',
        body: instructions, statusTo: 'IN_WORK', createdByUserId: user.id } });
      await db.clientRequestEvent.create({ data: { requestId: plan.request.id, clientId: dto.clientId, eventType: 'COMMENT',
        title: 'Заказ перенесён в сборку с заменой размера', body: `WB №${dto.orderId} → заявка №${request.number}. ${instructions}`, createdByUserId: user.id } });
      return { id: request.id, number: request.number };
    }, { isolationLevel: 'Serializable', timeout: 30_000 }).catch(async error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        const saved = await this.approved(this.prisma, dto.taskId, dto.clientId, warehouseId);
        if (saved?.sourceSkuId === dto.sourceSkuId) return this.prisma.clientRequest.findUniqueOrThrow({ where: { id: saved.requestId }, select: { id: true, number: true } });
        throw new ConflictException('Заказ или остатки изменились параллельно. Повторите подбор.');
      }
      throw error;
    });
    this.connections.invalidateRepeatAssemblyCache(dto.clientId);
    return created;
  }
}

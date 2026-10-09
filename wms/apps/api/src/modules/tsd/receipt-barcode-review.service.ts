import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { StockOperationsService } from '../stock/stock-operations.service';
import { TsdPayloadParser } from './tsd-payload.parser';
import type { ScanOperationDto } from './dto/scan-operation.dto';
import type { TsdOperationResult } from './tsd-operation.types';
import { isBarcodeReview, receiptBarcodeReviewEnabled, receiptBarcodeRisk, requireReceiptReviewer } from './receipt-barcode-policy';
import { consumeLegacyHold } from './receipt-barcode-legacy';

@Injectable()
export class ReceiptBarcodeReviewService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService,
    private readonly stock: StockOperationsService, private readonly parser: TsdPayloadParser) {}

  // FIX: hold before SKU creation or receipt; retries keep the immutable first evidence.
  async capture(operation: ScanOperationDto, user: AuthUser): Promise<TsdOperationResult | null> {
    if (!receiptBarcodeReviewEnabled()) return null;
    const input = this.parser.parseReceiptPayload(operation.payload);
    this.scopes.requireClientAccess(user, input.clientId, 'write');
    if (!user.activeWarehouseId) throw new BadRequestException('Выберите филиал приёмки.');
    const known = input.barcode ? await this.prisma.barcode.findFirst({ where: {
      value: input.barcode, sku: { clientId: input.clientId, isDraft: false },
    }, select: { id: true } }) : true;
    const reason = input.barcode ? receiptBarcodeRisk(input.barcode, !!known) : null;
    if (!reason) return null;
    if (!user.permissionCodes.includes('system:admin') && !user.writableWarehouseIds?.includes(user.activeWarehouseId)) throw new ForbiddenException('Нет права изменения филиала приёмки.');
    if (input.boxCode) {
      const box = await this.prisma.box.findUnique({ where: { code: input.boxCode } });
      if (!box || box.clientId !== input.clientId || box.warehouseId !== user.activeWarehouseId || box.status !== 'receiving') {
        throw new BadRequestException('Для разбора нужен открытый короб текущей приёмки.');
      }
    }
    const message = `${reason}. Позиция ожидает проверки в «Проблемах приёмки», остаток не создан.`;
    const stored = await this.prisma.tsdOperation.upsert({ where: { operationKey: operation.operationKey }, update: {}, create: {
      operationKey: operation.operationKey, operationType: 'receipt_scan', deviceId: operation.deviceId,
      status: 'NEEDS_REVIEW', reviewReason: 'VALIDATION_ERROR', serverMessage: message,
      payload: { ...operation.payload, barcodeReview: 'PENDING', barcodeReviewReason: reason,
        warehouseId: user.activeWarehouseId, actorUserId: user.id, actorName: user.name || user.email,
        firstBarcodeScan: input.barcode!, secondBarcodeScan: String(operation.payload.secondBarcodeScan || ''),
      } as Prisma.InputJsonObject,
    } });
    return { operationKey: operation.operationKey, operationType: operation.operationType,
      status: stored.status === 'ACCEPTED' ? 'ALREADY_APPLIED' : stored.status,
      message: stored.resolutionMessage || stored.serverMessage || message, serverTime: new Date().toISOString() };
  }

  private access(user: AuthUser) {
    requireReceiptReviewer(user);
    if (!receiptBarcodeReviewEnabled()) throw new NotFoundException('Проверка ШК не включена.');
    if (!user.activeWarehouseId) throw new BadRequestException('Выберите филиал.');
    if (!user.permissionCodes.includes('system:admin') && !user.writableWarehouseIds?.includes(user.activeWarehouseId)) {
      throw new ForbiddenException('Нет права изменения выбранного филиала.');
    }
  }

  private async scope(user: AuthUser) {
    this.access(user);
    const scope = this.scopes.resolveClientFilter(user);
    const clients = await this.prisma.client.findMany({ where: { id: scope }, select: { id: true, name: true, code: true } });
    const where: Prisma.TsdOperationWhereInput = { operationType: 'receipt_scan', AND: [
      { payload: { path: ['barcodeReview'], equals: 'PENDING' } },
      { payload: { path: ['warehouseId'], equals: user.activeWarehouseId! } },
      { OR: clients.map(c => ({ payload: { path: ['clientId'], equals: c.id } })) },
    ] };
    return {where, clients};
  }

  async summary(user: AuthUser) {
    const {where} = await this.scope(user);
    return {pending: await this.prisma.tsdOperation.count({where: {...where, status: 'NEEDS_REVIEW'}})};
  }

  async list(user: AuthUser) {
    const {where, clients} = await this.scope(user);
    const pending = await this.prisma.tsdOperation.count({where: {...where, status: 'NEEDS_REVIEW'}});
    const select = { id: true, deviceId: true, payload: true, status: true, createdAt: true, reviewedAt: true,
      resolutionMessage: true, reviewComment: true, reviewedBy: {select: {name: true}} } as const;
    // FIX: enum order must not let rejected history displace pending work.
    const items = await this.prisma.tsdOperation.findMany({where: {...where, status: 'NEEDS_REVIEW'},
      orderBy: {createdAt: 'asc'}, take: 200, select});
    if (items.length < 200) items.push(...await this.prisma.tsdOperation.findMany({where: {...where,
      status: {not: 'NEEDS_REVIEW'}, reviewedAt: {gte: new Date(Date.now() - 7 * 86400000)}},
      orderBy: {reviewedAt: 'desc'}, take: 200 - items.length, select}));
    return {pending, items: items.map(item => ({...item,
      client: clients.find(c => c.id === (item.payload as any)?.clientId) || null}))};
  }

  async resolve(id: string, dto: { action: 'CONFIRM' | 'CORRECT' | 'REJECT'; barcode?: string; comment: string }, user: AuthUser) {
    this.access(user);
    if (!dto.comment?.trim()) throw new BadRequestException('Укажите основание решения.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "TsdOperation" WHERE id=${id} FOR UPDATE`;
      const operation = await tx.tsdOperation.findUnique({ where: { id } });
      if (!operation || !isBarcodeReview(operation.payload)) throw new NotFoundException('Обращение не найдено.');
      const evidence = operation.payload as Prisma.JsonObject;
      const input = this.parser.parseReceiptPayload(evidence);
      this.scopes.requireClientAccess(user, input.clientId, 'write');
      if (evidence.warehouseId !== user.activeWarehouseId) throw new ForbiddenException('Обращение другого филиала.');
      if (operation.status !== 'NEEDS_REVIEW') throw new BadRequestException('Решение уже принято. Обновите список.');
      if (input.boxCode) {
        const box = await tx.box.findUnique({ where: { code: input.boxCode } });
        if (!box || box.clientId !== input.clientId || box.warehouseId !== user.activeWarehouseId || !['active', 'receiving', 'archived'].includes(box.status)) {
          throw new BadRequestException('Короб перемещён или закрыт для приёмки. Проверьте физический товар.');
        }
        // A later box reuse must not accept an old physical item into a new receipt.
        const reuse = await tx.tsdOperation.findFirst({ where: { operationType: 'receipt_open_box', status: 'ACCEPTED',
          createdAt: { gt: operation.createdAt }, AND: [
            { payload: { path: ['boxCode'], equals: input.boxCode } },
            { OR: [{ payload: { path: ['reusedEmpty'], equals: true } }, { payload: { path: ['reopened'], equals: false } }] },
          ] }, select: { id: true } });
        if (reuse && dto.action !== 'REJECT') throw new BadRequestException('Короб уже переиспользован. Нужна проверка фактического размещения.');
      }
      // FIX: the reviewed barcode, not an untrusted cached SKU id, chooses the product.
      input.skuId = undefined;
      let barcode = input.barcode;
      if (dto.action === 'CORRECT') {
        barcode = dto.barcode?.trim();
        if (!barcode) throw new BadRequestException('Укажите правильный ШК.');
        const sku = await tx.barcode.findFirst({ where: { value: barcode, sku: { clientId: input.clientId, isDraft: false } }, select: { skuId: true } });
        if (!sku) throw new BadRequestException('Правильный ШК должен принадлежать существующей карточке этого клиента.');
        input.skuId = sku.skuId;
      } else if (dto.action !== 'CONFIRM' && dto.action !== 'REJECT') throw new BadRequestException('Неизвестное решение.');
      if (input.boxCode && dto.action !== 'REJECT') await tx.box.updateMany({where: {code: input.boxCode, status: 'archived'}, data: {status: 'active'}});
      if (typeof evidence.legacyHeldBalanceId === 'string') await consumeLegacyHold(tx, evidence.legacyHeldBalanceId,
        operation.operationKey, input.clientId, user.activeWarehouseId!, input.quantity);
      // FIX: original idempotency key also lets receipt_close verify an approved scan.
      if (dto.action !== 'REJECT') await this.stock.receiveIntoBox({ ...input, barcode, warehouseId: user.activeWarehouseId!,
        status: 'AVAILABLE', idempotencyKey: operation.operationKey,
        comment: `Проверка подозрительного ШК: ${dto.comment.trim()}`,
      }, user, tx, evidence.legacyHeldBalanceId ? 'INVENTORY_ADJUSTMENT' : 'RECEIPT');
      const resolutionMessage = dto.action === 'REJECT' ? 'Ошибочный скан отклонён, товар не оприходован.'
        : `Принято ${input.quantity} шт., ШК ${barcode}.`;
      await tx.tsdOperation.update({ where: { id }, data: { status: dto.action === 'REJECT' ? 'REJECTED' : 'ACCEPTED',
        reviewAction: dto.action === 'REJECT' ? 'REJECT' : 'APPLY_INVENTORY_ADJUSTMENT', reviewComment: dto.comment.trim(),
        resolutionMessage, reviewedAt: new Date(), reviewedByUserId: user.id,
      } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'RECEIPT_BARCODE_REVIEWED', entity: 'TsdOperation', entityId: id,
        payload: { action: dto.action, originalBarcode: input.barcode, barcode: barcode || null, quantity: input.quantity,
          comment: dto.comment.trim(), clientId: input.clientId, boxCode: input.boxCode || null } } });
      return { message: resolutionMessage };
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  }
}

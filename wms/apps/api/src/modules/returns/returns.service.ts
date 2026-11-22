import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { CreateReturnBatchDto, ScanReturnDto } from './returns.dto';
import { RETURN_PROCESSING_SERVICE, RETURN_STORAGE_STATUS, returnChargeKey, returnConditions, returnReceiptKey } from './returns-policy';

@Injectable()
export class ReturnsService {
  constructor(private readonly db: PrismaService, private readonly scopes: ClientScopeService) {}

  private scope(user: AuthUser, clientId: string, write = false) {
    if (process.env.WMS_RETURNS_PROCESSING_ENABLED !== 'true') throw new NotFoundException('Обработка возвратов не включена.');
    if (!clientId?.trim()) throw new BadRequestException('Выберите клиента.');
    this.scopes.requireClientAccess(user, clientId, write ? 'write' : 'read');
    const warehouseId = user.activeWarehouseId;
    if (!warehouseId || user.isDemo || user.roleCodes.includes('CLIENT') ||
        (!user.permissionCodes.includes('system:admin') && !(write ? user.writableWarehouseIds : user.warehouseIds)?.includes(warehouseId))) {
      throw new ForbiddenException('Нет доступа к обработке возвратов в этом филиале.');
    }
    return warehouseId;
  }

  async list(clientId: string, user: AuthUser) {
    const warehouseId = this.scope(user, clientId);
    return this.db.returnBatch.findMany({ where: { clientId, warehouseId }, include: { units: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async create(dto: CreateReturnBatchDto, user: AuthUser) {
    const warehouseId = this.scope(user, dto.clientId, true);
    await this.db.billingService.upsert({ where: { code: RETURN_PROCESSING_SERVICE }, update: {}, create: { code: RETURN_PROCESSING_SERVICE, name: 'Обработка возвратов', unit: 'PIECE' } });
    // FIX: caller UUID makes recovery after a lost response safe.
    const batch = await this.db.returnBatch.upsert({ where: { id: dto.id }, update: {}, create: {
      id: dto.id, clientId: dto.clientId, warehouseId, createdById: user.id, createdByName: user.name,
    }, include: { units: true } });
    if (batch.clientId !== dto.clientId || batch.warehouseId !== warehouseId) throw new ConflictException('Номер операции уже используется.');
    return batch;
  }

  private async lockedBatch(tx: Prisma.TransactionClient, id: string, user: AuthUser) {
    const batch = await tx.returnBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('Партия возвратов не найдена.');
    if (batch.warehouseId !== this.scope(user, batch.clientId, true)) throw new ForbiddenException();
    await tx.$queryRaw`SELECT "id" FROM "ReturnBatch" WHERE "id" = ${id} FOR UPDATE`;
    return (await tx.returnBatch.findUniqueOrThrow({ where: { id } }));
  }

  async scan(id: string, dto: ScanReturnDto, user: AuthUser) {
    return this.db.$transaction(async tx => {
      const batch = await this.lockedBatch(tx, id, user);
      const barcode = dto.barcode.trim(), boxCode = dto.boxCode.trim(), returnCode = dto.returnCode.trim();
      if (!barcode || !boxCode || !returnCode) throw new BadRequestException('Нужны код возврата, ШК товара и короб.');
      const previous = await tx.returnUnit.findUnique({ where: { id: dto.id } });
      if (previous) {
        if (previous.batchId !== id || previous.barcode !== barcode || previous.returnCode !== returnCode || previous.boxCode !== boxCode || previous.condition !== dto.condition || previous.marketplace !== dto.marketplace) throw new ConflictException('Повтор операции с другими данными.');
        return previous;
      }
      if (batch.status !== 'SORTING') throw new ConflictException('Сортировка уже завершена.');
      const skus = await tx.sku.findMany({ where: { clientId: batch.clientId, barcodes: { some: { value: barcode } } }, take: 2 });
      if (skus.length !== 1) throw new BadRequestException('ШК не найден однозначно у клиента. Проверьте фактический товар и карточку.');
      const box = await tx.box.findUnique({ where: { code: boxCode } });
      if (!box || box.status !== 'active' || box.clientId !== batch.clientId || box.warehouseId !== batch.warehouseId) throw new BadRequestException('Нужен действующий короб выбранного клиента и филиала.');
      await tx.$queryRaw`SELECT "id" FROM "Box" WHERE "id" = ${box.id} FOR UPDATE`;
      const [other, balances, duplicate] = await Promise.all([
        tx.returnUnit.findFirst({ where: { boxId: box.id, OR: [{ batchId: { not: id } }, { condition: { not: dto.condition } }] } }),
        tx.stockBalance.count({ where: { boxId: box.id, quantity: { gt: 0 } } }),
        tx.returnUnit.findFirst({ where: { clientId: batch.clientId, marketplace: dto.marketplace, returnCode, barcode } }),
      ]);
      if (duplicate) throw new ConflictException('Этот возврат уже зарегистрирован. Повторный приход не выполнен.');
      if (other || balances) throw new BadRequestException('Выберите пустой короб или короб этой партии с тем же состоянием товаров.');
      return tx.returnUnit.create({ data: { id: dto.id, batchId: id, clientId: batch.clientId, marketplace: dto.marketplace, returnCode, barcode,
        skuId: skus[0].id, productName: skus[0].name, condition: dto.condition, boxId: box.id, boxCode,
        scannedById: user.id, scannedByName: user.name } });
    });
  }

  async finish(id: string, user: AuthUser) {
    // FIX: batch lock and one transaction cover receipt, balance and the unique charge.
    return this.db.$transaction(async tx => {
      const batch = await this.lockedBatch(tx, id, user);
      if (batch.status === 'STORED') return tx.returnBatch.findUniqueOrThrow({ where: { id }, include: { units: true } });
      const units = await tx.returnUnit.findMany({ where: { batchId: id }, orderBy: { boxId: 'asc' } });
      if (!units.length) throw new BadRequestException('Сначала отсканируйте хотя бы один возврат.');
      // FIX: recheck all boxes before writes; sorting may have remained open during other receipts.
      for (const boxId of [...new Set(units.map(unit => unit.boxId))].sort()) {
        await tx.$queryRaw`SELECT "id" FROM "Box" WHERE "id" = ${boxId} FOR UPDATE`;
        if (await tx.stockBalance.count({ where: { boxId, quantity: { gt: 0 } } })) {
          throw new ConflictException('В коробе уже появился остаток. Проверьте короб перед завершением возвратов.');
        }
      }
      const service = await tx.billingService.upsert({ where: { code: RETURN_PROCESSING_SERVICE }, update: {}, create: { code: RETURN_PROCESSING_SERVICE, name: 'Обработка возвратов', unit: 'PIECE' } });
      const price = await tx.clientBillingService.findUnique({ where: { clientId_serviceId: { clientId: batch.clientId, serviceId: service.id } } });
      const basePrice = price?.isActive ? Number(price.priceRub) : service.defaultPriceRub == null ? null : Number(service.defaultPriceRub);
      const taxMode = price?.isActive ? price.taxMode : 'INCLUDED';
      const gross = (n: number) => Math.round((taxMode === 'ADD_6_PERCENT' ? n / 0.94 : n) * 100) / 100;
      const now = new Date();
      for (const unit of units) {
        await tx.$queryRaw`SELECT "id" FROM "Box" WHERE "id" = ${unit.boxId} FOR UPDATE`;
        const box = await tx.box.findUniqueOrThrow({ where: { id: unit.boxId } });
        if (box.status !== 'active' || box.warehouseId !== batch.warehouseId || box.clientId !== batch.clientId) throw new ConflictException('Короб изменён во время сортировки. Проверьте размещение.');
        await tx.stockMovement.create({ data: { clientId: batch.clientId, warehouseId: batch.warehouseId, skuId: unit.skuId, boxId: unit.boxId,
          palletId: box.palletId, type: 'RETURN', status: RETURN_STORAGE_STATUS, quantity: 1,
          idempotencyKey: returnReceiptKey(unit.id), sourceDocument: `returns:${id}`, comment: `Возврат ${unit.returnCode}; ${returnConditions[unit.condition]}; ${user.name}`, createdAt: now } });
        const balanceKey = [batch.clientId, unit.skuId, unit.boxId, box.palletId ?? 'no-pallet', RETURN_STORAGE_STATUS].join(':');
        await tx.stockBalance.upsert({ where: { balanceKey }, update: { quantity: { increment: 1 } }, create: {
          balanceKey, clientId: batch.clientId, warehouseId: batch.warehouseId, skuId: unit.skuId, boxId: unit.boxId, palletId: box.palletId, status: RETURN_STORAGE_STATUS, quantity: 1 } });
      }
      await tx.billingCharge.create({ data: { clientId: batch.clientId, serviceId: service.id, description: 'Обработка возвратов', unit: 'PIECE', quantity: units.length,
        unitPriceRub: gross(basePrice ?? 0), totalRub: gross((basePrice ?? 0) * units.length), source: 'MANUAL', sourceKey: returnChargeKey(id),
        createdByUserId: user.id, serviceDate: now, metadata: { batchId: id, warehouseId: batch.warehouseId, priceBeforeTaxRub: basePrice, taxMode,
          pricingStatus: basePrice == null ? 'PRICE_REVIEW' : 'PRICED' }, comment: basePrice == null ? 'Не задан тариф обработки возвратов. Требуется проверка цены.' : null } });
      await tx.returnUnit.updateMany({ where: { batchId: id }, data: { receivedAt: now } });
      return tx.returnBatch.update({ where: { id }, data: { status: 'STORED', completedAt: now, completedById: user.id }, include: { units: true } });
    }, { timeout: 30000 });
  }

  async export(id: string, user: AuthUser) {
    const batch = await this.db.returnBatch.findUnique({ where: { id }, include: { units: true } });
    if (!batch) throw new NotFoundException();
    if (batch.warehouseId !== this.scope(user, batch.clientId)) throw new ForbiddenException();
    const skus = await this.db.sku.findMany({ where: { clientId: batch.clientId, id: { in: [...new Set(batch.units.map(u => u.skuId))] } }, select: { id: true, article: true, size: true } });
    const products = new Map(skus.map(s => [s.id, s]));
    const book = new ExcelJS.Workbook();
    for (const [name, units] of [['Все возвраты', batch.units], ['Ожидают КИЗ', batch.units.filter(u => u.condition === 'NORMAL' && !u.releasedAt)]] as const) {
      const sheet = book.addWorksheet(name);
      sheet.columns = [{ header: 'Короб', key: 'boxCode', width: 28 }, { header: 'ШК товара', key: 'barcode', width: 22 }, { header: 'Товар', key: 'productName', width: 45 }, { header: 'Артикул', key: 'article', width: 25 }, { header: 'Размер', key: 'size', width: 15 }, { header: 'Состояние', key: 'condition', width: 30 }, { header: 'Количество', key: 'quantity', width: 14 }, { header: 'Код возврата', key: 'returnCode', width: 32 }, { header: 'Маркетплейс', key: 'marketplace', width: 20 }];
      units.forEach(u => sheet.addRow({ ...u, article: products.get(u.skuId)?.article ?? '', size: products.get(u.skuId)?.size ?? '', condition: returnConditions[u.condition], quantity: 1 }));
      sheet.getColumn('barcode').numFmt = '@';
      sheet.getColumn('returnCode').numFmt = '@';
    }
    return Buffer.from(await book.xlsx.writeBuffer());
  }
}

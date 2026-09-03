import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ClientRequestEventType,
  ClientRequestPriority,
  ClientRequestStatus,
  ClientRequestType,
  MovementType,
  Prisma,
  SkuCollectionScanStatus,
  StockStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { StockBalancesService } from '../stock/stock-balances.service';
import type {
  CreateSkuCollectionDto,
  ScanSkuCollectionPickDto,
  ScanSkuCollectionReceiptDto,
} from './dto/sku-collection.dto';
import { assertSkuCollectionPick, assertSkuCollectionReceipt } from './sku-collection-policy';

const requestInclude = {
  client: { select: { id: true, name: true } },
  items: { include: { sku: { include: { barcodes: true } } } },
  skuCollectionSources: { orderBy: { sourceBoxCode: 'asc' } },
  skuCollectionScans: { orderBy: { pickedAt: 'desc' } },
} satisfies Prisma.ClientRequestInclude;

@Injectable()
export class SkuCollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly balances: StockBalancesService,
  ) {}

  async search(clientId: string, search: string, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const warehouseId = this.requireWarehouse(user, 'read');
    const query = search.trim();
    if (!query) return [];

    const skus = await this.prisma.sku.findMany({
      where: {
        clientId,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { internalSku: { contains: query, mode: 'insensitive' } },
          { clientSku: { contains: query, mode: 'insensitive' } },
          { article: { contains: query, mode: 'insensitive' } },
          { barcodes: { some: { value: { contains: query } } } },
        ],
        balances: {
          some: {
            warehouseId,
            status: StockStatus.AVAILABLE,
            quantity: { gt: 0 },
            boxId: { not: null },
          },
        },
      },
      include: {
        barcodes: true,
        balances: {
          where: {
            warehouseId,
            status: StockStatus.AVAILABLE,
            quantity: { gt: 0 },
            boxId: { not: null },
          },
          include: { box: { include: { pallet: true } } },
        },
      },
      orderBy: { name: 'asc' },
      take: 50,
    });

    return skus.map((sku) => ({
      id: sku.id,
      internalSku: sku.internalSku,
      clientSku: sku.clientSku,
      article: sku.article,
      name: sku.name,
      color: sku.color,
      size: sku.size,
      needsChestnyZnak: sku.needsChestnyZnak,
      barcodes: sku.barcodes.map((barcode) => barcode.value),
      availableQuantity: sku.balances.reduce((sum, balance) => sum + balance.quantity, 0),
      boxes: sku.balances.map((balance) => ({
        id: balance.box!.id,
        code: balance.box!.code,
        palletCode: balance.box!.pallet?.code ?? null,
        quantity: balance.quantity,
      })),
    }));
  }

  async create(dto: CreateSkuCollectionDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    const warehouseId = this.requireWarehouse(user, 'write');

    return this.prisma.$transaction(async (tx) => {
      const sku = await tx.sku.findFirst({
        where: { id: dto.skuId, clientId: dto.clientId },
        include: { barcodes: { orderBy: { isPrimary: 'desc' } } },
      });
      if (!sku) throw new NotFoundException('Товар клиента не найден.');
      if (!sku.needsChestnyZnak || sku.isUnmarked) {
        throw new BadRequestException('Сборка по SKU доступна только для маркированного товара с КИЗ.');
      }

      // FIX: lock the source balance rows before snapshotting the whole SKU into this request.
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "StockBalance"
        WHERE "clientId" = ${dto.clientId}
          AND "warehouseId" = ${warehouseId}
          AND "skuId" = ${sku.id}
          AND "status" = 'AVAILABLE'
          AND "boxId" IS NOT NULL
        FOR UPDATE
      `);

      const available = await tx.stockBalance.findMany({
        where: {
          clientId: dto.clientId,
          warehouseId,
          skuId: sku.id,
          status: StockStatus.AVAILABLE,
          quantity: { gt: 0 },
          boxId: { not: null },
          box: { status: { notIn: ['deleted', 'archived'] } },
        },
        include: { box: true },
        orderBy: { box: { code: 'asc' } },
      });
      if (available.length === 0) throw new BadRequestException('Для товара нет доступного остатка в коробах этого филиала.');

      const quantity = available.reduce((sum, balance) => sum + balance.quantity, 0);
      const barcode = sku.barcodes[0]?.value ?? sku.internalSku;
      const request = await tx.clientRequest.create({
        data: {
          clientId: dto.clientId,
          warehouseId,
          type: ClientRequestType.SKU_COLLECTION,
          status: ClientRequestStatus.APPROVED,
          priority: ClientRequestPriority.NORMAL,
          title: `Сборка по SKU · ${sku.name}`,
          comment: '[SKU_COLLECTION] Внутренняя сборка для повторной приёмки по коробам.',
          createdByUserId: user.id,
          items: { create: { skuId: sku.id, barcode, name: sku.name, quantity } },
          skuCollectionSources: {
            create: available.map((balance) => ({
              clientId: dto.clientId,
              warehouseId,
              skuId: sku.id,
              sourceBoxId: balance.box!.id,
              sourceBoxCode: balance.box!.code,
              plannedQuantity: balance.quantity,
            })),
          },
          events: {
            create: {
              clientId: dto.clientId,
              eventType: ClientRequestEventType.CREATED,
              title: 'Создана внутренняя сборка по SKU',
              body: `${quantity} ед. из ${available.length} коробов`,
              createdByUserId: user.id,
            },
          },
        },
      });

      for (const balance of available) {
        // FIX: reserve the exact current stock so ordinary routes cannot select it while consolidation is active.
        await this.moveBalance(tx, balance, StockStatus.RESERVED, balance.quantity);
        await tx.stockMovement.createMany({
          data: [
            {
              warehouseId,
              clientId: dto.clientId,
              skuId: sku.id,
              boxId: balance.boxId,
              palletId: balance.palletId,
              type: MovementType.RESERVE,
              status: StockStatus.AVAILABLE,
              quantity: -balance.quantity,
              sourceDocument: request.id,
              comment: 'Резерв для сборки по SKU',
            },
            {
              warehouseId,
              clientId: dto.clientId,
              skuId: sku.id,
              boxId: balance.boxId,
              palletId: balance.palletId,
              type: MovementType.RESERVE,
              status: StockStatus.RESERVED,
              quantity: balance.quantity,
              sourceDocument: request.id,
              comment: 'Резерв для сборки по SKU',
            },
          ],
        });
        const marks = await tx.productMark.findMany({
          where: { clientId: dto.clientId, skuId: sku.id, boxId: balance.boxId, status: StockStatus.AVAILABLE },
          select: { id: true },
          take: balance.quantity,
        });
        if (marks.length) {
          await tx.productMark.updateMany({ where: { id: { in: marks.map((mark) => mark.id) } }, data: { status: StockStatus.RESERVED } });
        }
      }

      return tx.clientRequest.findUniqueOrThrow({ where: { id: request.id }, include: requestInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async list(user: AuthUser) {
    const warehouseId = this.requireWarehouse(user, 'read');
    const clientId = this.clientScopes.resolveClientFilter(user);
    return this.prisma.clientRequest.findMany({
      where: {
        warehouseId,
        clientId,
        type: ClientRequestType.SKU_COLLECTION,
        status: { in: [ClientRequestStatus.APPROVED, ClientRequestStatus.IN_WORK, ClientRequestStatus.PACKED] },
      },
      include: requestInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(id: string, user: AuthUser) {
    const request = await this.prisma.clientRequest.findFirst({
      where: { id, type: ClientRequestType.SKU_COLLECTION },
      include: requestInclude,
    });
    if (!request) throw new NotFoundException('Заявка «Сборка по SKU» не найдена.');
    this.clientScopes.requireClientAccess(user, request.clientId, 'read');
    if (request.warehouseId !== this.requireWarehouse(user, 'read')) throw new NotFoundException('Заявка относится к другому филиалу.');
    return request;
  }

  async pick(id: string, dto: ScanSkuCollectionPickDto, user: AuthUser) {
    const scan = assertSkuCollectionPick(dto);
    return this.prisma.$transaction(async (tx) => {
      // FIX: one request-level row lock prevents two TSDs from consuming the same last unit.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ClientRequest" WHERE "id" = ${id} FOR UPDATE`);
      const request = await this.requireRequest(tx, id, user, [ClientRequestStatus.APPROVED, ClientRequestStatus.IN_WORK]);
      const existing = await tx.skuCollectionScan.findUnique({ where: { requestId_kiz: { requestId: id, kiz: scan.kiz } } });
      if (existing) return this.summary(tx, id);

      const source = request.skuCollectionSources.find((item) =>
        item.sourceBoxCode.toLocaleUpperCase('ru-RU') === scan.sourceBoxCode.toLocaleUpperCase('ru-RU') && item.pickedQuantity < item.plannedQuantity,
      );
      if (!source) throw new BadRequestException('Этот короб не содержит неотобранный товар данной заявки.');
      await this.assertBarcode(tx, source.skuId, scan.barcode);

      const mark = await tx.productMark.findFirst({
        where: { clientId: request.clientId, value: { equals: scan.kiz, mode: 'insensitive' } },
      });
      if (mark && (mark.skuId !== source.skuId || (mark.boxId && mark.boxId !== source.sourceBoxId))) {
        throw new BadRequestException('КИЗ зарегистрирован за другим товаром или другим коробом.');
      }

      const reserved = await tx.stockBalance.findFirst({
        where: { warehouseId: source.warehouseId, clientId: source.clientId, skuId: source.skuId, boxId: source.sourceBoxId, status: StockStatus.RESERVED, quantity: { gt: 0 } },
      });
      if (!reserved) throw new BadRequestException('Зарезервированный товар в исходном коробе закончился. Обновите заявку.');
      await this.moveBalance(tx, reserved, StockStatus.PACKING, 1, null, null);
      const movement = await tx.stockMovement.create({
        data: { warehouseId: source.warehouseId, clientId: source.clientId, skuId: source.skuId, type: MovementType.PICK, status: StockStatus.PACKING, quantity: 1, sourceDocument: id, comment: `Сборка по SKU из ${source.sourceBoxCode}` },
      });

      if (mark) {
        await tx.productMark.update({ where: { id: mark.id }, data: { skuId: source.skuId, boxId: null, status: StockStatus.PACKING, sourceDocument: id, stockMovementId: movement.id } });
      } else {
        await tx.productMark.create({ data: { clientId: source.clientId, skuId: source.skuId, value: scan.kiz, boxId: null, status: StockStatus.PACKING, sourceDocument: id, stockMovementId: movement.id } });
      }
      await tx.skuCollectionScan.create({
        data: { requestId: id, sourceId: source.id, skuId: source.skuId, barcode: scan.barcode, kiz: scan.kiz, sourceBoxId: source.sourceBoxId, sourceBoxCode: source.sourceBoxCode, pickedByUserId: user.id, pickedByName: user.name },
      });
      await tx.skuCollectionSource.update({ where: { id: source.id }, data: { pickedQuantity: { increment: 1 } } });
      await this.refreshRequestStatus(tx, id);
      return this.summary(tx, id);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async receive(id: string, dto: ScanSkuCollectionReceiptDto, user: AuthUser) {
    const existing = await this.prisma.skuCollectionScan.findUnique({ where: { requestId_kiz: { requestId: id, kiz: dto.kiz.trim() } } });
    const scan = assertSkuCollectionReceipt({ ...dto, pickedByThisRequest: Boolean(existing) });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ClientRequest" WHERE "id" = ${id} FOR UPDATE`);
      const request = await this.requireRequest(tx, id, user, [ClientRequestStatus.PACKED]);
      const picked = await tx.skuCollectionScan.findUnique({ where: { requestId_kiz: { requestId: id, kiz: scan.kiz } } });
      if (!picked) throw new BadRequestException('КИЗ не был отобран этой заявкой.');
      if (picked.status === SkuCollectionScanStatus.RECEIVED) return this.summary(tx, id);
      await this.assertBarcode(tx, picked.skuId, scan.barcode);

      const targetBox = await tx.box.findFirst({
        where: { code: { equals: scan.targetBoxCode, mode: 'insensitive' }, clientId: request.clientId, warehouseId: request.warehouseId, status: { notIn: ['deleted', 'archived'] } },
      });
      if (!targetBox) throw new BadRequestException('Короб приёмки не найден у этого клиента в активном филиале.');
      const packing = await tx.stockBalance.findFirst({ where: { warehouseId: request.warehouseId!, clientId: request.clientId, skuId: picked.skuId, boxId: null, palletId: null, status: StockStatus.PACKING, quantity: { gt: 0 } } });
      if (!packing) throw new BadRequestException('Отобранный товар уже принят или отсутствует в промежуточном остатке.');
      await this.moveBalance(tx, packing, StockStatus.AVAILABLE, 1, targetBox.id, targetBox.palletId);
      const movement = await tx.stockMovement.create({ data: { warehouseId: request.warehouseId, clientId: request.clientId, skuId: picked.skuId, boxId: targetBox.id, palletId: targetBox.palletId, type: MovementType.RECEIPT, status: StockStatus.AVAILABLE, quantity: 1, sourceDocument: id, comment: `Повторная приёмка сборки по SKU в ${targetBox.code}` } });
      // FIX: this is the only duplicate-KIZ exception; the same mark is moved instead of being recreated.
      await tx.productMark.updateMany({ where: { clientId: request.clientId, value: { equals: scan.kiz, mode: 'insensitive' }, sourceDocument: id }, data: { boxId: targetBox.id, skuId: picked.skuId, status: StockStatus.AVAILABLE, stockMovementId: movement.id } });
      await tx.skuCollectionScan.update({ where: { id: picked.id }, data: { status: SkuCollectionScanStatus.RECEIVED, targetBoxId: targetBox.id, targetBoxCode: targetBox.code, receivedByUserId: user.id, receivedByName: user.name, receivedAt: new Date() } });
      await tx.skuCollectionSource.update({ where: { id: picked.sourceId }, data: { receivedQuantity: { increment: 1 } } });
      await this.refreshRequestStatus(tx, id);
      return this.summary(tx, id);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async requireRequest(tx: Prisma.TransactionClient, id: string, user: AuthUser, statuses: ClientRequestStatus[]) {
    const request = await tx.clientRequest.findFirst({ where: { id, type: ClientRequestType.SKU_COLLECTION, status: { in: statuses } }, include: { skuCollectionSources: true } });
    if (!request) throw new BadRequestException('Заявка уже не находится на этом этапе работы. Обновите список.');
    this.clientScopes.requireClientAccess(user, request.clientId, 'write');
    if (request.warehouseId !== this.requireWarehouse(user, 'write')) throw new ForbiddenException('Заявка относится к другому филиалу.');
    return request;
  }

  private async assertBarcode(tx: Prisma.TransactionClient, skuId: string, code: string) {
    const sku = await tx.sku.findUnique({ where: { id: skuId }, include: { barcodes: true } });
    const normalized = code.trim().toLocaleUpperCase('ru-RU');
    const codes = [sku?.internalSku, sku?.clientSku, sku?.article, ...(sku?.barcodes.map((item) => item.value) ?? [])]
      .filter(Boolean)
      .map((item) => item!.trim().toLocaleUpperCase('ru-RU'));
    if (!codes.includes(normalized)) throw new BadRequestException('Отсканирован другой товар.');
  }

  private async refreshRequestStatus(tx: Prisma.TransactionClient, requestId: string) {
    const totals = await tx.skuCollectionSource.aggregate({ where: { requestId }, _sum: { plannedQuantity: true, pickedQuantity: true, receivedQuantity: true } });
    const planned = totals._sum.plannedQuantity ?? 0;
    const picked = totals._sum.pickedQuantity ?? 0;
    const received = totals._sum.receivedQuantity ?? 0;
    const status = received >= planned
      ? ClientRequestStatus.DONE
      : picked >= planned
        ? ClientRequestStatus.PACKED
        : ClientRequestStatus.IN_WORK;
    await tx.clientRequest.update({ where: { id: requestId }, data: { status } });
  }

  private summary(tx: Prisma.TransactionClient, requestId: string) {
    return tx.clientRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestInclude });
  }

  private async moveBalance(
    tx: Prisma.TransactionClient,
    source: { id: string; warehouseId: string | null; clientId: string; skuId: string; boxId: string | null; palletId: string | null; status: StockStatus; quantity: number },
    targetStatus: StockStatus,
    quantity: number,
    targetBoxId: string | null = source.boxId,
    targetPalletId: string | null = source.palletId,
  ) {
    if (source.quantity < quantity) throw new BadRequestException('Недостаточно остатка для операции.');
    if (source.quantity === quantity) await tx.stockBalance.delete({ where: { id: source.id } });
    else await tx.stockBalance.update({ where: { id: source.id }, data: { quantity: { decrement: quantity } } });
    const warehouseId = source.warehouseId;
    if (!warehouseId) throw new BadRequestException('У остатка не указан филиал.');
    const input = { warehouseId, clientId: source.clientId, skuId: source.skuId, boxId: targetBoxId, palletId: targetPalletId, status: targetStatus };
    await tx.stockBalance.upsert({
      where: { balanceKey: this.balances.balanceKey(input) },
      update: { quantity: { increment: quantity }, warehouseId },
      create: { ...input, balanceKey: this.balances.balanceKey(input), quantity },
    });
  }

  private requireWarehouse(user: AuthUser, access: 'read' | 'write') {
    const warehouseId = user.activeWarehouseId?.trim();
    const allowed = access === 'write' ? user.writableWarehouseIds : user.warehouseIds;
    if (!warehouseId || (!user.permissionCodes.includes('system:admin') && !(allowed ?? []).includes(warehouseId))) {
      throw new ForbiddenException(access === 'write' ? 'Выберите филиал, доступный для изменения.' : 'Выберите активный филиал.');
    }
    return warehouseId;
  }
}

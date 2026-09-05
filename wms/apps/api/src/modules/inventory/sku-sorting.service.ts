import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ClientRequestStatus, InventorySessionType, Prisma, StockStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ArchivedEmptyBoxPalletDetachService } from '../../common/boxes/archived-empty-box-pallet-detach.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { StockBalancesService } from '../stock/stock-balances.service';
import { InventoryService } from './inventory.service';
import { skuSortingAllowed } from './sku-sorting-policy';
import { SkuCollectionService } from './sku-collection.service';
import type { MoveSkuSortingDto, CheckSkuSortingDto, ReadySkuSortingSourceDto } from './dto/sku-collection.dto';

// FIX: opt-in only on our WMS; the sold installation keeps its previous workflow.
const marker = '[SKU_SORTING_V2]';
const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

@Injectable()
export class SkuSortingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ClientScopeService,
    private readonly balances: StockBalancesService,
    private readonly collections: SkuCollectionService,
    private readonly inventory: InventoryService,
    private readonly emptyBoxes: ArchivedEmptyBoxPalletDetachService,
  ) {}

  private async request(db: Prisma.TransactionClient, id: string, user: AuthUser) {
    if (!skuSortingAllowed(user, id)) throw new ForbiddenException('Единая сортировка недоступна для этой пары ТСД и заявки.');
    const request = await db.clientRequest.findFirst({ where: { id, type: 'SKU_COLLECTION',
      status: { in: ['APPROVED', 'IN_WORK', 'PACKED', 'DONE'] } }, include: { skuCollectionSources: true } });
    if (!request) throw new BadRequestException('Активная заявка сортировки не найдена.');
    this.scopes.requireClientAccess(user, request.clientId, 'write');
    if (!request.warehouseId || request.warehouseId !== user.activeWarehouseId ||
        (!user.permissionCodes.includes('system:admin') && !(user.writableWarehouseIds ?? []).includes(request.warehouseId))) {
      throw new ForbiddenException('Заявка относится к другому или недоступному филиалу.');
    }
    return request;
  }

  async start(id: string, user: AuthUser) {
    // FIX: explicit POST, never a mutating GET. Release only a provable legacy reservation once.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ClientRequest" WHERE "id" = ${id} FOR UPDATE`);
      const request = await this.request(tx, id, user);
      if (request.comment?.includes(marker)) return;
      await this.assertMovementAllowed(tx);
      for (const source of request.skuCollectionSources) {
        const remaining = source.plannedQuantity - source.pickedQuantity;
        if (remaining <= 0) continue;
        const scope = { warehouseId: request.warehouseId!, clientId: request.clientId, skuId: source.skuId, boxId: source.sourceBoxId };
        const [reserved, evidence, assembly] = await Promise.all([
          tx.stockBalance.findMany({ where: { ...scope, status: 'RESERVED', quantity: { gt: 0 } } }),
          tx.stockMovement.aggregate({ where: { ...scope, sourceDocument: id, type: 'RESERVE', status: 'RESERVED' }, _sum: { quantity: true } }),
          tx.fbsTsdAssembly.findFirst({ where: { clientId: request.clientId, skuId: source.skuId,
            status: { in: ['IN_PROGRESS', 'RETURN_REQUIRED'] }, OR: [{ boxId: source.sourceBoxId }, { reservedBoxId: source.sourceBoxId }] }, select: { id: true } }),
        ]);
        if (assembly || reserved.length !== 1 || reserved[0].quantity !== remaining ||
            (evidence._sum.quantity ?? 0) - source.pickedQuantity !== remaining) {
          throw new ConflictException(`Резерв короба ${source.sourceBoxCode} нельзя однозначно отнести к этой заявке. Остатки не изменены.`);
        }
        const row = reserved[0];
        await tx.stockBalance.delete({ where: { id: row.id } });
        const input = { ...scope, palletId: row.palletId, status: StockStatus.AVAILABLE };
        await tx.stockBalance.upsert({ where: { balanceKey: this.balances.balanceKey(input) },
          create: { ...input, balanceKey: this.balances.balanceKey(input), quantity: remaining }, update: { quantity: { increment: remaining } } });
        await tx.stockMovement.createMany({ data: [
          { ...scope, palletId: row.palletId, type: 'RESERVE', status: 'RESERVED', quantity: -remaining, sourceDocument: id, comment: 'Снятие собственного резерва: сортировка без блокировки продаж' },
          { ...scope, palletId: row.palletId, type: 'RESERVE', status: 'AVAILABLE', quantity: remaining, sourceDocument: id, comment: 'Снятие собственного резерва: сортировка без блокировки продаж' },
        ] });
        await tx.productMark.updateMany({ where: { clientId: request.clientId, skuId: source.skuId, boxId: source.sourceBoxId, status: 'RESERVED' }, data: { status: 'AVAILABLE' } });
      }
      await tx.clientRequest.update({ where: { id }, data: { comment: `${request.comment ?? ''}\n${marker}` } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'SKU_SORTING_RESERVATION_RELEASED', entity: 'ClientRequest', entityId: id,
        payload: { warehouseId: request.warehouseId, clientId: request.clientId } } });
    }, { isolationLevel: 'Serializable', timeout: 30000 });
    return this.collections.get(id, user);
  }

  async openSource(id: string, sourceBoxCode: string, user: AuthUser, recount = false) {
    const request = await this.request(this.prisma, id, user);
    if (!request.comment?.includes(marker)) throw new ConflictException('Сначала откройте заявку в единой сортировке.');
    const source = request.skuCollectionSources.find(s => same(s.sourceBoxCode, sourceBoxCode));
    if (!source || source.pickedQuantity >= source.plannedQuantity) throw new BadRequestException('Этот короб не требуется в маршруте сортировки.');
    // FIX: counting is the existing inventory workflow, with original correction permissions.
    const title = `Сортировка №${request.number} · ${source.sourceBoxCode}`;
    let session = await this.prisma.inventorySession.findFirst({ where: { title, clientId: request.clientId,
      warehouseId: request.warehouseId, createdByUserId: user.id, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, include: { boxes: { include: { lines: true } } } });
    const active = await this.prisma.inventoryAuditBox.findFirst({ where: { boxId: source.sourceBoxId, status: 'COUNTING' }, select: { sessionId: true } });
    if (active && active.sessionId !== session?.id) throw new ConflictException('Этот короб уже проверяет другой сотрудник.');
    if (recount) {
      if (active) throw new ConflictException('Сначала завершите текущий подсчёт. Его данные не удалены.');
      session = null; // FIX: preserve the old decisions and start a genuinely fresh snapshot.
    }
    if (!session) session = await this.inventory.startSession({ type: InventorySessionType.BOX_CHECK, clientId: request.clientId, title, comment: '[SKU_SORTING_SOURCE]' }, user);
    const existing = session.boxes.find(b => b.boxId === source.sourceBoxId);
    const box = existing ?? await this.inventory.openBox(session.id, source.sourceBoxCode, user, true);
    return { session, box };
  }

  private async checkedSource(tx: Prisma.TransactionClient, id: string, dto: ReadySkuSortingSourceDto, user: AuthUser) {
    const request = await this.request(tx, id, user);
    await this.assertMovementAllowed(tx);
    if (!request.comment?.includes(marker) || request.status === 'DONE') throw new ConflictException('Обновите заявку сортировки.');
    const source = request.skuCollectionSources.find(s => same(s.sourceBoxCode, dto.sourceBoxCode));
    if (!source) throw new BadRequestException('Исходный короб не входит в заявку.');
    const audit = await tx.inventoryAuditBox.findUnique({ where: { id: dto.auditBoxId }, include: { session: true, lines: true } });
    if (!audit || audit.boxId !== source.sourceBoxId || audit.clientId !== request.clientId || audit.session.warehouseId !== request.warehouseId ||
        !['MATCHED', 'RESOLVED'].includes(audit.status) || audit.lines.some(l => l.decision === 'PENDING' ||
          (l.difference && !l.decisionComment?.startsWith('[APPLY_ACTUAL]')))) {
      throw new ConflictException('Сначала завершите сверку и актуализацию исходного короба.');
    }
    const counting = await tx.inventoryAuditBox.findFirst({ where: { boxId: source.sourceBoxId, status: 'COUNTING' }, select: { id: true } });
    if (counting) throw new ConflictException('В исходном коробе начат новый подсчёт. Завершите его перед перемещением.');
    return { request, source, audit };
  }

  async ready(id: string, dto: ReadySkuSortingSourceDto, user: AuthUser) {
    // FIX: refresh the route from actual AVAILABLE stock, including a now-empty source.
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ClientRequest" WHERE "id" = ${id} FOR UPDATE`);
      if ((await this.request(tx, id, user)).status === 'DONE') return; // FIX: retry after zero-stock completion.
      const { request, source } = await this.checkedSource(tx, id, dto, user);
      const total = await tx.stockBalance.aggregate({ where: { warehouseId: request.warehouseId!, clientId: request.clientId,
        skuId: source.skuId, boxId: source.sourceBoxId, status: 'AVAILABLE', quantity: { gt: 0 } }, _sum: { quantity: true } });
      await tx.skuCollectionSource.update({ where: { id: source.id }, data: { plannedQuantity: source.pickedQuantity + (total._sum.quantity ?? 0) } });
      await this.refreshTotals(tx, id);
    }, { isolationLevel: 'Serializable' });
    return this.collections.get(id, user);
  }

  private async candidate(tx: Prisma.TransactionClient, id: string, dto: CheckSkuSortingDto, user: AuthUser) {
    const { request, source, audit } = await this.checkedSource(tx, id, dto, user);
    const sku = await tx.sku.findUnique({ where: { id: source.skuId }, include: { barcodes: true } });
    if (!sku?.barcodes.some(b => b.value === dto.barcode.trim())) throw new BadRequestException('ШК не соответствует SKU заявки.');
    // FIX: KIZ identity is case-sensitive. Never seize a mark already picked/shipped for another task.
    const identity = dto.kiz.trim().split('\u001d')[0];
    const mark = await tx.productMark.findFirst({ where: { clientId: request.clientId, value: { startsWith: identity } } });
    if (mark && (mark.skuId !== source.skuId || mark.boxId !== source.sourceBoxId || mark.status !== 'AVAILABLE')) {
      throw new ConflictException('КИЗ не числится доступным за этим товаром в исходном коробе. Остатки не изменены.');
    }
    const [assembly, shipped, printed] = await Promise.all([
      tx.fbsTsdAssembly.findFirst({ where: { kiz: { startsWith: identity }, status: { in: ['IN_PROGRESS', 'RETURN_REQUIRED', 'COMPLETED'] } }, select: { id: true } }),
      tx.shippedKizHistory.findFirst({ where: { kiz: { startsWith: identity } }, select: { id: true } }),
      tx.fbsWebKizStickerPrint.findFirst({ where: { kiz: { startsWith: identity } }, select: { id: true } }),
    ]);
    if (assembly || shipped || printed) throw new ConflictException('КИЗ связан с заказом или отгрузкой. Перемещение не выполнено.');
    const balance = await tx.stockBalance.findFirst({ where: { warehouseId: request.warehouseId!, clientId: request.clientId, skuId: source.skuId,
      boxId: source.sourceBoxId, status: 'AVAILABLE', quantity: { gt: 0 } } });
    if (!balance) throw new ConflictException('Свободный товар в исходном коробе закончился. Обновите маршрут.');
    if (!mark) {
      // FIX: reuse actualization scan evidence to bind an unrecorded KIZ without adding stock.
      if (!/^01\d{14}21[^\u0000-\u001f]{13}$/.test(identity)) throw new BadRequestException('Отсканируйте полный КИЗ единицы из проверки короба.');
      const evidenceId = createHash('sha256').update(JSON.stringify([dto.auditBoxId, audit.startedAt.toISOString(), identity])).digest('hex');
      const evidence = await tx.auditLog.findUnique({ where: { id: evidenceId } });
      const payload = evidence?.payload as { skuId?: string; boxId?: string } | null;
      const registered = await tx.productMark.count({ where: { clientId: request.clientId, skuId: source.skuId, boxId: source.sourceBoxId, status: 'AVAILABLE' } });
      if (evidence?.action !== 'INVENTORY_KIZ_SCAN' || payload?.skuId !== source.skuId || payload.boxId !== source.sourceBoxId || registered >= balance.quantity) {
        throw new ConflictException('Новый КИЗ не подтверждён этой актуализацией или все единицы уже имеют КИЗ. Остатки не изменены.');
      }
    }
    return { request, source, mark, balance };
  }

  async check(id: string, dto: CheckSkuSortingDto, user: AuthUser) {
    await this.candidate(this.prisma, id, dto, user);
    return { state: 'TARGET_BOX', message: 'Отсканируйте целевой короб. До этого остатки не перемещаются.' };
  }

  async move(id: string, dto: MoveSkuSortingDto, user: AuthUser) {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ClientRequest" WHERE "id" = ${id} FOR UPDATE`);
      await this.request(tx, id, user);
      const existing = await tx.skuCollectionScan.findUnique({ where: { requestId_kiz: { requestId: id, kiz: dto.kiz.trim() } } });
      if (existing) {
        if (existing.status === 'RECEIVED' && same(existing.targetBoxCode ?? '', dto.targetBoxCode) && same(existing.sourceBoxCode, dto.sourceBoxCode) && existing.barcode === dto.barcode.trim()) return;
        throw new ConflictException('Этот КИЗ уже учтён в заявке. Для ранее отобранного товара используйте «Разместить отобранное».');
      }
      const { request, source, mark, balance } = await this.candidate(tx, id, dto, user);
      const target = await tx.box.findFirst({ where: { code: { equals: dto.targetBoxCode.trim(), mode: 'insensitive' },
        clientId: request.clientId, warehouseId: request.warehouseId, status: { notIn: ['deleted', 'archived'] } } });
      if (!target || target.id === source.sourceBoxId) throw new BadRequestException('Нужен другой действующий целевой короб того же клиента и филиала.');
      const targetCounting = await tx.inventoryAuditBox.findFirst({ where: { boxId: target.id, status: 'COUNTING' }, select: { id: true } });
      if (targetCounting) throw new ConflictException('Целевой короб сейчас пересчитывается. Выберите другой или завершите проверку.');
      if (request.skuCollectionSources.some(s => s.sourceBoxId === target.id && s.pickedQuantity < s.plannedQuantity)) {
        throw new ConflictException('Целевой короб ещё есть в маршруте отбора. Выберите другой короб, чтобы не отбирать перемещённое повторно.');
      }
      const changed = await tx.stockBalance.updateMany({ where: { id: balance.id, quantity: { gte: 1 } }, data: { quantity: { decrement: 1 } } });
      if (changed.count !== 1) throw new ConflictException('Остаток изменился. Повторите сканирование.');
      const input = { warehouseId: request.warehouseId!, clientId: request.clientId, skuId: source.skuId, boxId: target.id, palletId: target.palletId, status: StockStatus.AVAILABLE };
      await tx.stockBalance.upsert({ where: { balanceKey: this.balances.balanceKey(input) },
        create: { ...input, balanceKey: this.balances.balanceKey(input), quantity: 1 }, update: { quantity: { increment: 1 } } });
      const movementId = randomUUID();
      await tx.stockMovement.createMany({ data: [
        { ...input, boxId: source.sourceBoxId, palletId: balance.palletId, type: 'MOVE', quantity: -1, sourceDocument: id, comment: `Сортировка: в ${target.code}` },
        { ...input, id: movementId, type: 'MOVE', quantity: 1, sourceDocument: id, comment: `Сортировка: из ${source.sourceBoxCode}` },
      ] });
      if (mark) {
        const updated = await tx.productMark.updateMany({ where: { id: mark.id, boxId: source.sourceBoxId, status: 'AVAILABLE' }, data: { boxId: target.id, stockMovementId: movementId } });
        if (updated.count !== 1) throw new ConflictException('КИЗ изменился параллельно. Остатки не изменены.');
      } else {
        await tx.productMark.create({ data: { clientId: request.clientId, skuId: source.skuId, value: dto.kiz.trim(), boxId: target.id,
          status: 'AVAILABLE', sourceDocument: id, stockMovementId: movementId } });
      }
      await tx.skuCollectionScan.create({ data: { requestId: id, sourceId: source.id, skuId: source.skuId, barcode: dto.barcode.trim(), kiz: dto.kiz.trim(),
        sourceBoxId: source.sourceBoxId, sourceBoxCode: source.sourceBoxCode, targetBoxId: target.id, targetBoxCode: target.code,
        status: 'RECEIVED', pickedByUserId: user.id, pickedByName: user.name, receivedByUserId: user.id, receivedByName: user.name, receivedAt: new Date() } });
      await tx.skuCollectionSource.update({ where: { id: source.id }, data: {
        plannedQuantity: source.pickedQuantity + balance.quantity, pickedQuantity: { increment: 1 }, receivedQuantity: { increment: 1 },
      } });
      await this.refreshTotals(tx, id);
      const archived = await tx.box.updateMany({ where: { id: source.sourceBoxId, balances: { none: { quantity: { gt: 0 } } } }, data: { status: 'archived' } });
      if (archived.count) await this.emptyBoxes.detachIfArchivedAndEmpty({ boxId: source.sourceBoxId, userId: user.id, reason: 'sku-sorting' }, tx);
    }, { isolationLevel: 'Serializable', timeout: 15000 });
    return this.collections.get(id, user);
  }

  private async refreshTotals(tx: Prisma.TransactionClient, id: string) {
    const totals = await tx.skuCollectionSource.aggregate({ where: { requestId: id }, _sum: { plannedQuantity: true, pickedQuantity: true, receivedQuantity: true } });
    const planned = totals._sum.plannedQuantity ?? 0;
    await tx.clientRequestItem.updateMany({ where: { requestId: id }, data: { quantity: planned } });
    await tx.clientRequest.update({ where: { id }, data: { status: (totals._sum.receivedQuantity ?? 0) >= planned ? ClientRequestStatus.DONE : ClientRequestStatus.IN_WORK } });
  }

  private async assertMovementAllowed(tx: Prisma.TransactionClient) {
    const full = await tx.inventorySession.findFirst({ where: { type: 'FULL', status: { in: ['ACTIVE', 'REVIEW'] } }, select: { id: true } });
    if (full) throw new ConflictException('Перемещения остановлены на время полной инвентаризации.');
  }
}

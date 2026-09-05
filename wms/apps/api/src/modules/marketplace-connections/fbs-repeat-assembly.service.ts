import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { MarketplaceConnectionsService } from './marketplace-connections.service';
import type { CreateFbsRepeatAssemblyDto, PreviewFbsRepeatAssemblyDto } from './dto/fbs-repeat-assembly.dto';
import { assertRepeatAssemblyEnabled, assertRepeatCandidate, createRepeatAttemptData, repeatSelectionFingerprint } from './fbs-repeat-assembly';
import { allocateRepeatStock } from './fbs-repeat-stock-plan';

type WbStatuses = Map<string, { supplierStatus: string; wbStatus: string }>;
const key = (text: string | null | undefined) => (text ?? '').trim().toLocaleLowerCase('ru-RU');
const jsonSnapshot = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const allowed = (user: AuthUser) => !user.isDemo && user.roleCodes.some(role => ['ADMIN', 'OWNER'].includes(role));

@Injectable()
export class FbsRepeatAssemblyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ClientScopeService,
    private readonly connections: MarketplaceConnectionsService,
  ) {}

  capabilities(user: AuthUser) {
    return { enabled: allowed(user) && process.env.WMS_FBS_REPEAT_ASSEMBLY_ENABLED === 'true' };
  }

  private authorize(dto: PreviewFbsRepeatAssemblyDto, user: AuthUser) {
    assertRepeatAssemblyEnabled();
    if (!allowed(user)) throw new ForbiddenException('Повторную физическую сборку создаёт администратор или владелец.');
    this.scopes.requireClientAccess(user, dto.clientId, 'write');
    const warehouseId = user.activeWarehouseId;
    if (!warehouseId || (user.writableWarehouseIds && !user.writableWarehouseIds.includes(warehouseId))) {
      throw new ForbiddenException('Выберите доступный для работы филиал.');
    }
    if (!dto.orders.length || dto.orders.length > 100) {
      throw new BadRequestException('Выберите от 1 до 100 заказов с идентификаторами предыдущих сборок.');
    }
    const connections = new Set(dto.orders.map(order => order.connectionId));
    if (connections.size !== 1 || new Set(dto.orders.map(order => order.id)).size !== dto.orders.length) {
      throw new BadRequestException('Выберите неповторяющиеся заказы одного кабинета WB.');
    }
    return warehouseId;
  }

  private async wb(dto: PreviewFbsRepeatAssemblyDto, user: AuthUser) {
    return this.connections.readRepeatAssemblyWbStatuses(dto.clientId, dto.orders[0].connectionId, dto.orders.map(row => row.id), user);
  }

  async preview(dto: PreviewFbsRepeatAssemblyDto, user: AuthUser) {
    const warehouseId = this.authorize(dto, user);
    const statuses = await this.wb(dto, user);
    return this.prisma.$transaction(async tx => {
      const plan = await this.plan(tx, dto, warehouseId, statuses);
      return this.describe(plan);
    }, { isolationLevel: 'RepeatableRead', timeout: 30_000 });
  }

  async create(dto: CreateFbsRepeatAssemblyDto, user: AuthUser) {
    const warehouseId = this.authorize(dto, user);
    if (dto.confirmAdditionalStockConsumption !== true) throw new BadRequestException('Подтвердите дополнительное физическое списание.');
    if (dto.orders.some(order => !order.assemblyId)) throw new BadRequestException('Сначала выполните предварительную проверку сборок.');
    const fingerprint = repeatSelectionFingerprint(dto.clientId, warehouseId, dto.orders);
    const previous = await this.existing(fingerprint);
    if (previous) return previous;
    const statuses = await this.wb(dto, user);
    const checkedAt = Date.now();
    try {
      const request = await this.prisma.$transaction(async tx => {
        // FIX: serialize repeat submissions for the same selection. Normal scans
        // are guarded below by the old task id and updatedAt, never by order id.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${fingerprint}))::text`;
        const same = await tx.fbsRepeatAssemblyRun.findUnique({ where: { fingerprint } });
        if (same) return tx.clientRequest.findUniqueOrThrow({ where: { id: same.requestId } });
        const plan = await this.plan(tx, dto, warehouseId, statuses);
        if (Date.now() - checkedAt > 60_000 || this.describe(plan).previewToken !== dto.previewToken) {
          throw new ConflictException('Данные изменились. Повторите предварительную проверку; новая заявка не создана.');
        }
        const now = new Date();
        const runId = randomUUID();
        const sourceNumbers = [...new Set(plan.rows.map(row => row.link.request.number))];
        const sourceSupplies = [...new Set(plan.rows.map(row => row.task.supplyId).filter(Boolean))];
        const itemGroups = new Map<string, { skuId: string; name: string; barcode: string | null; quantity: number; comment: string }>();
        for (const row of plan.rows) {
          const group = itemGroups.get(row.task.skuId);
          if (group) { group.quantity++; group.comment += `, ${row.task.orderId}`; }
          else itemGroups.set(row.task.skuId, { skuId: row.task.skuId, name: row.task.productName,
            barcode: Array.isArray(row.task.barcodes) ? String(row.task.barcodes[0] ?? '') : null,
            quantity: 1, comment: `FBS-заказы (повторная сборка): ${row.task.orderId}` });
        }
        const created = await tx.clientRequest.create({ data: {
          clientId: dto.clientId, warehouseId, type: 'OUTBOUND', status: 'IN_WORK', priority: 'HIGH',
          title: `Повторная сборка WB — ${plan.rows.length} заказов`, destinationCity: 'Повторный довоз WB',
          comment: `ОТДЕЛЬНАЯ ПОВТОРНАЯ СБОРКА. Дополнительный физический расход подтверждён ${user.name}. ` +
            `Исходные заявки: ${sourceNumbers.join(', ')}. Поставки: ${sourceSupplies.join(', ')}. ` +
            'Прежние КИЗ, печать, списания и выработка сохранены. Статусы и КИЗ в WB не изменяются.',
          createdByUserId: user.id, fbsEmergencyAssemblyAt: now,
          fbsEmergencyAssemblyByUserId: user.id, fbsEmergencyAssemblyByName: user.name,
          items: { create: [...itemGroups.values()] },
        }, include: { items: true } });
        await tx.fbsRepeatAssemblyRun.create({ data: { id: runId, fingerprint, clientId: dto.clientId,
          warehouseId, requestId: created.id, createdByUserId: user.id } });
        for (const row of plan.rows) {
          // FIX: all orders of one SKU share the correct aggregate item quantity.
          const item = created.items.find(item => item.skuId === row.task.skuId)!;
          const successorId = randomUUID();
          await tx.fbsAssemblyAttemptHistory.create({ data: {
            id: row.task.id, clientId: row.task.clientId, requestId: row.task.requestId,
            orderId: row.task.orderId, workerUserId: row.task.workerUserId,
            completedAt: row.task.completedAt!, successorId, repeatRunId: runId,
            taskSnapshot: jsonSnapshot(row.task), kiz: row.task.kiz, linkSnapshot: jsonSnapshot(row.link), archivedByUserId: user.id,
          } });
          const allocation = row.allocation;
          const source = row.source;
          const relabel = source.id !== row.task.skuId;
          const changed = await tx.fbsTsdAssembly.updateMany({
            where: { id: row.task.id, updatedAt: row.task.updatedAt, status: 'COMPLETED', requestId: row.task.requestId },
            data: {
              ...createRepeatAttemptData(row.task, successorId, created.id, item.id, now),
              status: 'RESERVED', reservedBoxId: allocation.boxId, reservedBoxCode: allocation.box!.code, reservedAt: now,
              sourceSkuId: relabel ? source.id : null, sourceProductName: relabel ? source.name : null,
              sourceArticle: relabel ? source.article : null,
              sourceBarcodes: relabel ? source.barcodes.map(barcode => barcode.value) : [],
              relabelRequired: relabel,
              storageBoxes: [{ code: allocation.box!.code, quantity: 1 }],
            },
          });
          if (changed.count !== 1) throw new ConflictException(`Сборка заказа ${row.task.orderId} изменилась; все изменения отменены.`);
          const linked = await tx.fbsOrderRequestLink.updateMany({
            where: { id: row.link.id, updatedAt: row.link.updatedAt, requestId: row.task.requestId },
            data: { requestId: created.id, syncStatus: 'ACTIVE', syncIssue: null,
              lastCategory: 'shipped', lastSupplierStatus: 'complete', lastWbStatus: 'waiting',
              lastSeenAt: now, createdByUserId: user.id },
          });
          if (linked.count !== 1) throw new ConflictException(`Привязка заказа ${row.task.orderId} изменилась; все изменения отменены.`);
          await tx.clientRequestBoxSelection.upsert({
            where: { requestItemId_boxId: { requestItemId: item.id, boxId: allocation.boxId! } },
            create: { requestItemId: item.id, skuId: source.id, boxId: allocation.boxId!, quantity: 1 },
            update: { quantity: { increment: 1 } },
          });
        }
        await tx.auditLog.create({ data: { userId: user.id, action: 'FBS_INDEPENDENT_REPEAT_CREATED',
          entity: 'ClientRequest', entityId: created.id,
          payload: { runId, fingerprint, clientId: dto.clientId, warehouseId,
            orderIds: plan.rows.map(row => row.task.orderId), previousAttemptIds: plan.rows.map(row => row.task.id),
            additionalStockConsumptionApproved: true, wbMutationPerformed: false },
        } });
        await tx.clientRequestEvent.create({ data: { requestId: created.id, clientId: dto.clientId,
          eventType: 'CREATED', title: 'Создана отдельная повторная сборка',
          body: `Исходные заявки: ${sourceNumbers.join(', ')}. Прежняя история сохранена.`,
          statusTo: 'IN_WORK', createdByUserId: user.id },
        });
        return created;
      }, { isolationLevel: 'Serializable', timeout: 60_000, maxWait: 10_000 });
      this.connections.invalidateRepeatAssemblyCache(dto.clientId);
      return { status: 'CREATED', request };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        const existing = await this.existing(fingerprint);
        if (existing) return existing;
        throw new ConflictException('Остатки или сборка изменились параллельно. Повторите проверку; заявка не создана.');
      }
      throw error;
    }
  }

  private async existing(fingerprint: string) {
    const run = await this.prisma.fbsRepeatAssemblyRun.findUnique({ where: { fingerprint } });
    if (!run) return null;
    return { status: 'ALREADY_EXISTS', request: await this.prisma.clientRequest.findUniqueOrThrow({ where: { id: run.requestId } }) };
  }

  private async plan(db: Prisma.TransactionClient, dto: PreviewFbsRepeatAssemblyDto, warehouseId: string, wb: WbStatuses) {
    const [client, tasks, links, skus, mappings, warehouse] = await Promise.all([
      db.client.findUniqueOrThrow({ where: { id: dto.clientId } }),
      db.fbsTsdAssembly.findMany({ where: { clientId: dto.clientId, marketplace: 'WILDBERRIES',
        connectionId: dto.orders[0].connectionId, orderId: { in: dto.orders.map(row => row.id) } }, include: { cargoPacking: true } }),
      db.fbsOrderRequestLink.findMany({ where: { clientId: dto.clientId, marketplace: 'WILDBERRIES',
        connectionId: dto.orders[0].connectionId, orderId: { in: dto.orders.map(row => row.id) } }, include: { request: true } }),
      db.sku.findMany({ where: { clientId: dto.clientId }, include: { barcodes: true } }),
      db.clientArticleMapping.findMany({ where: { clientId: dto.clientId } }),
      db.warehouse.findFirst({ where: { id: warehouseId, isActive: true } }),
    ]);
    if (!warehouse || client.isDemo) throw new ForbiddenException('Рабочий филиал или клиент недоступен.');
    const selected = dto.orders.map(order => {
      const task = tasks.find(task => (!order.assemblyId || task.id === order.assemblyId) && task.orderId === order.id);
      const link = links.find(link => link.orderId === order.id && link.requestId === task?.requestId);
      if (!task || !link || link.request.warehouseId !== warehouseId || ['REMOVED', 'MOVING', 'RETURN_REQUIRED'].includes(link.syncStatus)) {
        throw new ConflictException(`Заказ ${order.id} изменился или относится к другому филиалу.`);
      }
      assertRepeatCandidate(task, wb.get(order.id) ?? null);
      const target = skus.find(sku => sku.id === task.skuId);
      if (!target) throw new BadRequestException(`Карточка товара заказа ${order.id} не найдена.`);
      const rules = client.relabelingEnabled ? mappings.filter(mapping =>
        [target.article, target.clientSku, target.internalSku, task.article].map(key).includes(key(mapping.targetArticle))) : [];
      const candidateSkuIds = [target.id, ...skus.filter(sku => key(sku.size) === key(target.size) && rules.some(mapping =>
        [sku.article, sku.clientSku, sku.internalSku].map(key).includes(key(mapping.sourceArticle)) ||
        key(sku.internalSku).startsWith(`${key(mapping.sourceArticle)}-`))).map(sku => sku.id)];
      return { task, link, candidateSkuIds };
    });
    const skuIds = [...new Set(selected.flatMap(row => row.candidateSkuIds))];
    const [balances, reservations] = await Promise.all([
      db.stockBalance.findMany({ where: { clientId: dto.clientId, warehouseId, skuId: { in: skuIds },
        status: 'AVAILABLE', quantity: { gt: 0 }, boxId: { not: null },
        box: { clientId: dto.clientId, warehouseId, status: { notIn: ['deleted', 'archived', 'shipped'] } } },
        include: { box: true }, orderBy: { id: 'asc' } }),
      this.connections.repeatAssemblyStockReservations(dto.clientId, skuIds, db),
    ]);
    const placements = await db.storagePalletBox.findMany({ where: {
      boxCode: { in: balances.map(balance => balance.box!.code) }, pallet: { clientId: dto.clientId, warehouseId },
    }, include: { pallet: true } });
    const usable = balances.filter(balance => client.stockBalanceMode !== 'PALLET_SORT' || placements.some(row => row.boxCode === balance.box!.code));
    const buckets = usable.map(balance => ({ ...balance, boxId: balance.boxId!, quantity: Math.max(0, balance.quantity -
      (reservations.get(balance.skuId) ?? []).filter(row => row.boxId === balance.boxId).reduce((sum, row) => sum + row.itemCount, 0)) }));
    const allocations = allocateRepeatStock(selected.map(row => ({ id: row.task.orderId, candidateSkuIds: row.candidateSkuIds })), buckets);
    // The existing selection key is item+box, not item+box+physical-SKU.
    // Fail closed instead of silently recording the wrong relabel source.
    const sourceByItemBox = new Map<string, string>();
    for (const row of selected) {
      const allocation = allocations.get(row.task.orderId)!;
      const selectionKey = `${row.task.skuId}:${allocation.boxId}`;
      const previousSource = sourceByItemBox.get(selectionKey);
      if (previousSource && previousSource !== allocation.skuId) {
        throw new BadRequestException('В одном коробе выбраны разные исходные артикулы для одной позиции. Разделите повторную сборку на две заявки.');
      }
      sourceByItemBox.set(selectionKey, allocation.skuId);
    }
    return { rows: selected.map(row => {
      const allocation = usable.find(balance => balance.id === allocations.get(row.task.orderId)!.id)!;
      return { ...row, allocation, source: skus.find(sku => sku.id === allocation.skuId)!,
        palletCode: placements.find(placement => placement.boxCode === allocation.box!.code)?.pallet.code ?? null };
    }) };
  }

  private describe(plan: Awaited<ReturnType<FbsRepeatAssemblyService['plan']>>) {
    const orders = plan.rows.map(row => ({ id: row.task.orderId, connectionId: row.task.connectionId,
      assemblyId: row.task.id, productName: row.task.productName, article: row.task.article,
      sourceRequestNumber: row.link.request.number, sourceSupplyId: row.task.supplyId,
      boxCode: row.allocation.box!.code, palletCode: row.palletCode, sourceSkuId: row.source.id,
    }));
    const revision = plan.rows.map(row => [row.task.id, row.task.updatedAt, row.link.updatedAt,
      row.allocation.id, row.allocation.updatedAt, row.source.id]);
    return { orders, orderCount: orders.length, additionalUnits: orders.length,
      previewToken: createHash('sha256').update(JSON.stringify(revision)).digest('hex'),
      warning: 'Это дополнительная физическая сборка с новым расходом остатков. Прежняя сборка и её списания сохраняются. КИЗ и статусы в WB не изменяются.' };
  }
}

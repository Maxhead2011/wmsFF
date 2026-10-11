import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { wbReservationQuantities } from '../../common/stock/wb-order-stock-lifecycle';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { pendingReceiptBoxIds, receiptAllows, receiptRules } from '../warehouse/receipt-channel-policy';
import { marketplaceJson, MarketplaceConnectionsService } from './marketplace-connections.service';
import type { CreateFbsManualAssemblyDto, PreviewFbsManualAssemblyDto } from './dto/fbs-manual-assembly.dto';
import { manualAssemblyAllowed, manualAssemblyEnabled, manualHash, manualOrderIds, requireManualAssembly,
  untouchedManualTask, validateManualChoices, type ManualRow } from './fbs-manual-assembly';

type Db = Prisma.TransactionClient;
type WbOrder = { id: string; supplyId: string; barcodes: string[]; article: string; warehouseId: string;
  createdAt: string; supplierStatus: string; wbStatus: string; supplyOpen: boolean; member: boolean };
type PreviewState = { actorId: string; input: PreviewFbsManualAssemblyDto; expiresAt: number; fingerprint: string;
  result?: { id: string; number: number; status: string }; choiceHash?: string };
const prefix = 'fbs.manual.preview.v1:';
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const ids = (values: string[]) => [...new Set(values)];
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const openStatuses = ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'IN_WORK', 'PACKED'] as const;

@Injectable()
export class FbsManualAssemblyService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService,
    private readonly connections: MarketplaceConnectionsService) {}

  capabilities(user: AuthUser) { return { enabled: manualAssemblyEnabled() && manualAssemblyAllowed(user) }; }
  async options(clientId: string, user: AuthUser) {
    requireManualAssembly(user);
    if (!clientId) throw new BadRequestException('Выберите клиента.');
    this.scopes.requireClientAccess(user, clientId, 'write');
    const [connections, warehouses] = await Promise.all([
      this.prisma.clientMarketplaceConnection.findMany({ where: { clientId, marketplace: 'WILDBERRIES', isActive: true },
        select: { id: true, accountName: true, sellerId: true } }),
      this.prisma.warehouse.findMany({ where: { isActive: true, ...(user.writableWarehouseIds ? { id: { in: user.writableWarehouseIds } } : {}) },
        select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return { connections, warehouses };
  }

  private async authorize(input: PreviewFbsManualAssemblyDto, user: AuthUser) {
    requireManualAssembly(user); this.scopes.requireClientAccess(user, input.clientId, 'write');
    manualOrderIds(input.orderIds);
    if (!input.warehouseId || (user.writableWarehouseIds && !user.writableWarehouseIds.includes(input.warehouseId)))
      throw new ForbiddenException('Нет права создавать заявку в этом филиале.');
    const [client, warehouse, connection] = await Promise.all([
      this.prisma.client.findFirst({ where: { id: input.clientId, isDemo: false }, select: { id: true } }),
      this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, isActive: true }, select: { id: true } }),
      this.prisma.clientMarketplaceConnection.findFirst({ where: { id: input.connectionId, clientId: input.clientId, marketplace: 'WILDBERRIES', isActive: true } }),
    ]);
    if (!client || !warehouse || !connection) throw new ForbiddenException('Клиент, филиал или кабинет WB недоступен.');
    return connection;
  }

  // FIX: use the shared WB limiter and fresh reads only; do not reconcile unrelated orders.
  async readOrders(apiKey: string, orderIds: string[]): Promise<WbOrder[]> {
    const read = (path: string, body?: unknown) => marketplaceJson('https://marketplace-api.wildberries.ru' + path, {
      method: body ? 'POST' : 'GET', headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25_000),
    });
    const wanted = new Set(orderIds), found = new Map<string, Record<string, unknown>>(), cursors = new Set<number>();
    const dateFrom = Math.floor(Date.now() / 1000) - 30 * 86400;
    let next = 0;
    for (let page = 0; page < 100; page++) {
      if (cursors.has(next)) throw new BadRequestException('WB повторил страницу заказов. Проверка не завершена.');
      cursors.add(next);
      const data = await read(`/api/v3/orders?limit=1000&next=${next}&dateFrom=${dateFrom}`);
      if (!Array.isArray(data.orders) || !Number.isSafeInteger(data.next) || Number(data.next) < 0)
        throw new BadRequestException('WB вернул неполный список заказов. Повторите проверку.');
      for (const raw of data.orders) {
        const order = record(raw), id = String(order.id);
        if (wanted.has(id)) {
          if (found.has(id) && manualHash(found.get(id)) !== manualHash(order)) throw new ConflictException(`WB вернул разные данные заказа ${id}.`);
          found.set(id, order);
        }
      }
      next = Number(data.next);
      if (!next || found.size === wanted.size) break;
      if (page === 99) throw new BadRequestException('Достигнут предел проверки WB; результат неполный. Уточните кабинет.');
    }
    const data = await read('/api/v3/orders/status', { orders: orderIds.map(Number) });
    if (!Array.isArray(data.orders)) throw new BadRequestException('WB не подтвердил статусы заказов.');
    const statuses = new Map(data.orders.map(raw => { const row = record(raw); return [String(row.id), row] as const; }));
    const supplies = new Map<string, { open: boolean; members: Set<string> }>();
    for (const supplyId of ids([...found.values()].map(o => String(o.supplyId || '')).filter(Boolean))) {
      const info = await read(`/api/v3/supplies/${encodeURIComponent(supplyId)}`);
      const members = await read(`/api/marketplace/v3/supplies/${encodeURIComponent(supplyId)}/order-ids`);
      if (info.id !== supplyId || typeof info.done !== 'boolean' || !Array.isArray(members.orderIds))
        throw new BadRequestException('WB не подтвердил состав поставки.');
      supplies.set(supplyId, { open: !info.done, members: new Set(members.orderIds.map(String)) });
    }
    return orderIds.map(id => {
      const order = found.get(id), status = statuses.get(id), supplyId = String(order?.supplyId || '');
      return { id, supplyId, barcodes: Array.isArray(order?.skus) ? order.skus.map(String) : [], article: String(order?.article || ''),
        warehouseId: String(order?.warehouseId || ''), createdAt: String(order?.createdAt || ''),
        supplierStatus: String(status?.supplierStatus || ''), wbStatus: String(status?.wbStatus || ''),
        supplyOpen: supplies.get(supplyId)?.open || false, member: supplies.get(supplyId)?.members.has(id) || false };
    });
  }

  private async inspect(db: Db, input: PreviewFbsManualAssemblyDto, wb: WbOrder[]) {
    const { clientId, connectionId, warehouseId, orderIds } = input;
    const [tasks, links, skus] = await Promise.all([
      db.fbsTsdAssembly.findMany({ where: { clientId, connectionId, marketplace: 'WILDBERRIES', orderId: { in: orderIds } } }),
      db.fbsOrderRequestLink.findMany({ where: { clientId, connectionId, orderId: { in: orderIds } }, include: { request: { select: { number: true } } } }),
      db.sku.findMany({ where: { clientId, barcodes: { some: { value: { in: ids(wb.flatMap(o => o.barcodes)) } } } }, include: { barcodes: true } }),
    ]);
    // FIX: task fields alone cannot disprove a historical physical pick or shipment.
    const [shipments, picks] = tasks.length ? await Promise.all([
      db.wbOrderShipment.findMany({ where: { clientId, assemblyId: { in: tasks.map(t => t.id) } }, select: { assemblyId: true } }),
      db.stockMovement.findMany({ where: { clientId, status: 'PACKING', quantity: { gt: 0 },
        OR: tasks.map(t => ({ idempotencyKey: { startsWith: `fbs-sticker-pick:${t.id}:` } })) }, select: { idempotencyKey: true } }),
    ]) : [[], []];
    const physicalTaskIds = new Set([...shipments.map(s => s.assemblyId), ...picks.map(p => p.idempotencyKey?.split(':')[1])]);
    const skuIds = skus.map(s => s.id);
    const [balances, totalReserved, boxReserved, selections, rules, pending] = await Promise.all([
      db.stockBalance.findMany({ where: { clientId, warehouseId, skuId: { in: skuIds }, status: 'AVAILABLE', quantity: { gt: 0 },
        box: { clientId, warehouseId, status: 'active', storagePlacement: { pallet: { clientId, warehouseId } } } },
        include: { box: { include: { storagePlacement: { include: { pallet: true } } } } }, orderBy: { id: 'asc' } }),
      wbReservationQuantities(db, clientId, skuIds, warehouseId),
      this.connections.repeatAssemblyStockReservations(clientId, skuIds, db),
      db.clientRequestBoxSelection.findMany({ where: { skuId: { in: skuIds }, requestItem: { request: { clientId, warehouseId, status: { in: [...openStatuses] } } } },
        select: { skuId: true, boxId: true, quantity: true } }),
      receiptRules(db, clientId, warehouseId), pendingReceiptBoxIds(db, [clientId], warehouseId),
    ]);
    const rows: ManualRow[] = wb.map(order => {
      const task = tasks.find(t => t.orderId === order.id), link = links.find(l => l.orderId === order.id);
      const matches = skus.filter(s => s.barcodes.some(b => order.barcodes.includes(b.value)));
      const sku = matches.length === 1 ? matches[0] : null, blockers: string[] = [];
      if (!order.barcodes.length) blockers.push('Заказ не найден в этом кабинете за последние 30 дней.');
      if (order.supplierStatus !== 'confirm' || order.wbStatus !== 'waiting') blockers.push('Нужен статус WB «на сборке / ожидает».');
      if (!order.supplyOpen || !order.member) blockers.push('WB не подтвердил заказ в открытой поставке.');
      if (link) blockers.push(`Уже есть связь с заявкой №${link.request.number}.`);
      if (!untouchedManualTask(task)) blockers.push('Заказ уже обрабатывается или содержит физические сканы.');
      if (task && physicalTaskIds.has(task.id)) blockers.push('У заказа уже есть факт отбора или отгрузки.');
      if (!sku) blockers.push(matches.length > 1 ? 'Штрихкод соответствует нескольким карточкам WMS.' : 'Карточка товара WMS не найдена.');
      if (sku && task && task.skuId !== sku.id) blockers.push('Карточка WMS отличается от текущего заказа WB.');
      const candidates = balances.filter(b => b.skuId === sku?.id && b.boxId && !pending.includes(b.boxId) &&
        receiptAllows(rules.get(b.boxId), 'fbs', { marketplace: 'WILDBERRIES', connectionId, orderId: order.id }));
      // Selected untouched AUTO demand already counted in this branch must not reserve itself twice.
      const ownDemand = tasks.filter(t => t.skuId === sku?.id && t.stockWarehouseId === warehouseId && untouchedManualTask(t) &&
        ['WAITING_STOCK', 'RESERVED'].includes(t.status)).reduce((sum, t) => sum + t.itemCount, 0);
      const free = Math.max(0, candidates.reduce((sum, b) => sum + b.quantity, 0) - Math.max(0, (totalReserved.get(sku?.id || '') || 0) - ownDemand));
      const boxes = candidates.map(b => ({ boxId: b.boxId!, boxCode: b.box!.code, palletCode: b.box!.storagePlacement!.pallet.code,
        free: Math.max(0, b.quantity - (boxReserved.get(b.skuId) || []).filter(r => r.boxId === b.boxId).reduce((sum, r) => sum + r.itemCount, 0) -
          selections.filter(s => s.boxId === b.boxId && s.skuId === b.skuId).reduce((sum, s) => sum + s.quantity, 0)) })).filter(b => b.free > 0)
        .sort((a, b) => a.palletCode.localeCompare(b.palletCode, 'ru', { numeric: true }) || a.boxCode.localeCompare(b.boxCode));
      if (!free || !boxes.length) blockers.push('Нет свободного товара в разрешённых и согласованных коробах на палет-сортах.');
      return { orderId: order.id, skuId: sku?.id || null, article: sku?.article || order.article, size: sku?.size || '',
        supplyId: order.supplyId, supplierStatus: order.supplierStatus, wbStatus: order.wbStatus, blockers, boxes, free };
    });
    for (const row of rows) if (row.skuId && rows.filter(r => r.skuId === row.skuId).length > row.free)
      row.blockers.push('Свободного товара недостаточно на все выбранные заказы этого размера.');
    const fingerprint = manualHash({ wb, rows, tasks: tasks.map(({ updatedAt: _updatedAt, ...t }) => t).sort((a,b) => a.id.localeCompare(b.id)) });
    return { rows, fingerprint, tasks, skus };
  }

  async preview(dto: PreviewFbsManualAssemblyDto, user: AuthUser) {
    const input = { ...dto, orderIds: manualOrderIds(dto.orderIds) }, connection = await this.authorize(input, user);
    const wb = await this.readOrders(connection.apiKey, input.orderIds);
    return this.prisma.$transaction(async db => {
      const plan = await this.inspect(db, input, wb), canCreate = plan.rows.every(r => !r.blockers.length);
      const token = randomUUID(), expiresAt = Date.now() + 10 * 60_000;
      if (canCreate) await db.systemSetting.create({ data: { key: prefix + token, updatedByUserId: user.id,
        value: json({ actorId: user.id, input, expiresAt, fingerprint: plan.fingerprint } satisfies PreviewState) } });
      return { rows: plan.rows, canCreate, token: canCreate ? token : null, expiresAt: new Date(expiresAt).toISOString() };
    }, { timeout: 60_000 });
  }

  async create(dto: CreateFbsManualAssemblyDto, user: AuthUser) {
    requireManualAssembly(user);
    const key = prefix + dto.token, saved = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!saved) throw new ConflictException('Предварительная проверка не найдена. Проверьте заказы заново.');
    const state = saved.value as unknown as PreviewState;
    if (state.actorId !== user.id) throw new ForbiddenException('Проверка принадлежит другому пользователю.');
    const connection = await this.authorize(state.input, user);
    const choiceHash = manualHash([...dto.choices].sort((a,b) => a.orderId.localeCompare(b.orderId)));
    if (state.result) {
      if (state.choiceHash !== choiceHash) throw new ConflictException('Эта проверка уже использована с другими коробами.');
      return { request: state.result, alreadyCreated: true };
    }
    if (state.expiresAt < Date.now()) throw new ConflictException('Проверка устарела. Проверьте заказы заново.');
    const wb = await this.readOrders(connection.apiKey, state.input.orderIds);
    try {
      const result = await this.prisma.$transaction(async db => {
        await db.$queryRaw`SELECT key FROM "SystemSetting" WHERE key=${key} FOR UPDATE`;
        const locked = (await db.systemSetting.findUniqueOrThrow({ where: { key } })).value as unknown as PreviewState;
        if (locked.result) {
          if (locked.choiceHash !== choiceHash) throw new ConflictException('Проверка уже использована с другими коробами.');
          return { request: locked.result, alreadyCreated: true };
        }
        if (locked.expiresAt < Date.now()) throw new ConflictException('Проверка устарела.');
        const { clientId, connectionId, warehouseId, orderIds } = state.input;
        // FIX: ordered task/balance locks plus SERIALIZABLE prevent concurrent reservation and stale preview commits.
        await db.$queryRaw(Prisma.sql`SELECT id FROM "FbsTsdAssembly" WHERE "connectionId"=${connectionId} AND "orderId" IN (${Prisma.join(orderIds)}) ORDER BY id FOR UPDATE`);
        const selectedBoxes = ids(dto.choices.map(c => c.boxId)).sort();
        if (!selectedBoxes.length) throw new BadRequestException('Выберите короба.');
        // Same box lock as the physical FBS/FBO scan paths. Never lock an entire warehouse.
        await db.$queryRaw(Prisma.sql`SELECT id FROM "Box" WHERE "clientId"=${clientId} AND "warehouseId"=${warehouseId} AND id IN (${Prisma.join(selectedBoxes)}) ORDER BY id FOR UPDATE`);
        await db.$queryRaw(Prisma.sql`SELECT id FROM "StockBalance" WHERE "clientId"=${clientId} AND "warehouseId"=${warehouseId} AND "boxId" IN (${Prisma.join(selectedBoxes)}) AND status='AVAILABLE' ORDER BY id FOR UPDATE`);
        const plan = await this.inspect(db, state.input, wb);
        if (plan.fingerprint !== locked.fingerprint) throw new ConflictException('Заказы, остатки или маршрут изменились. Проверьте заказы заново.');
        validateManualChoices(plan.rows, dto.choices);
        const groups = ids(plan.rows.map(r => r.skuId!)).map(skuId => {
          const sku = plan.skus.find(s => s.id === skuId)!, rows = plan.rows.filter(r => r.skuId === skuId);
          return { skuId, name: `${sku.article || sku.name} · ${sku.size || ''}`, barcode: (sku.barcodes.find(b => b.isPrimary) || sku.barcodes[0]).value,
            quantity: rows.length, comment: 'WB: ' + rows.map(r => r.orderId).join(', ') };
        });
        const request = await db.clientRequest.create({ data: { clientId, warehouseId, type: 'OUTBOUND', status: 'IN_WORK', priority: 'NORMAL',
          title: `ФБС по номерам — ${orderIds.length} заказ(а/ов)`, destinationCity: 'Маркетплейс FBS', createdByUserId: user.id,
          comment: `Сервис: сборка по номерам. Заказы: ${orderIds.join(', ')}. Поставки: ${ids(wb.map(o => o.supplyId)).join(', ')}.`, items: { create: groups } },
          include: { items: true } });
        for (const row of plan.rows) {
          const old = plan.tasks.find(t => t.orderId === row.orderId), sku = plan.skus.find(s => s.id === row.skuId)!;
          const box = row.boxes.find(b => b.boxId === dto.choices.find(c => c.orderId === row.orderId)!.boxId)!;
          const data = { clientId, connectionId, marketplace: 'WILDBERRIES' as const, orderId: row.orderId, supplyId: row.supplyId,
            requestId: request.id, requestItemId: request.items.find(i => i.skuId === row.skuId)!.id, skuId: row.skuId!, stockWarehouseId: warehouseId,
            productName: sku.name, article: sku.article, barcodes: sku.barcodes.map(b => b.value), storageBoxes: [{ code: box.boxCode, quantity: 1, status: 'AVAILABLE' }],
            itemCount: 1, requiresKiz: sku.needsChestnyZnak, status: 'RESERVED', deviceCode: 'AUTO:FBS', reservedBoxId: box.boxId,
            reservedBoxCode: box.boxCode, reservedAt: new Date(), errorMessage: null, wbMetaStatus: sku.needsChestnyZnak ? 'PENDING' : 'NOT_REQUIRED' };
          if (old) await db.fbsTsdAssembly.update({ where: { id: old.id, updatedAt: old.updatedAt }, data });
          else await db.fbsTsdAssembly.create({ data });
          const order = wb.find(o => o.id === row.orderId)!;
          await db.fbsOrderRequestLink.create({ data: { clientId, connectionId, marketplace: 'WILDBERRIES', orderId: row.orderId, requestId: request.id,
            createdByUserId: user.id, syncStatus: 'ACTIVE', lastCategory: 'active', lastSupplierStatus: order.supplierStatus, lastWbStatus: order.wbStatus,
            lastSupplyId: row.supplyId, lastSkuId: row.skuId, lastItemCount: 1, lastSeenAt: new Date(), sellerWarehouseId: order.warehouseId || null,
            orderPlacedAt: Number.isFinite(Date.parse(order.createdAt)) ? new Date(order.createdAt) : null } });
        }
        const summary = { id: request.id, number: request.number, status: request.status };
        await db.clientRequestEvent.create({ data: { requestId: request.id, clientId, eventType: 'CREATED', title: 'Сборка ФБС по номерам',
          body: orderIds.join(', '), statusTo: 'IN_WORK', createdByUserId: user.id } });
        await db.auditLog.create({ data: { userId: user.id, action: 'FBS_MANUAL_ASSEMBLY_CREATED', entity: 'ClientRequest', entityId: request.id,
          payload: json({ input: state.input, choices: dto.choices, supplyIds: ids(wb.map(o => o.supplyId)), previousTasks: plan.tasks, wbMutations: false }) } });
        await db.systemSetting.update({ where: { key }, data: { value: json({ ...locked, result: summary, choiceHash }) } });
        return { request: summary, alreadyCreated: false };
      }, { isolationLevel: 'Serializable', timeout: 60_000, maxWait: 10_000 });
      this.connections.invalidateRepeatAssemblyCache(state.input.clientId);
      return result;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002', 'P2025'].includes(e.code))
        throw new ConflictException('Данные изменились параллельно. Повторите создание с той же проверкой; если заявка уже сохранена, будет возвращён её номер.');
      throw e;
    }
  }
}

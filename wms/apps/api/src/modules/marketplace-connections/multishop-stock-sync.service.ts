import { BadRequestException, ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { MultishopStockGroupsService, ShopConfiguration } from './multishop-stock-groups.service';
import { MarketplaceConnectionsService } from './marketplace-connections.service';
import { MarketplaceStockControlService } from './marketplace-stock-control.service';
import { productLinksEnabled, readProductLinks } from './marketplace-product-links';
import { allocateShopStock, validateShopGroups } from './multishop-stock-plan';
import { MULTISHOP_ACTIVE_PREFIX, ShopOwnership } from './multishop-stock-ownership';
import { MultishopStockQueue } from './multishop-stock-queue';
import { advanceShopPublication, ShopPublicationJob } from './multishop-stock-publication';
import { MultishopStockTransport, ShopDestination } from './multishop-stock-transport';
import { ozonReservationLines, StockOrderLine } from './multishop-stock-snapshot';
import { readSharedStock } from './multishop-stock-reader';

type Active = ShopOwnership & { clientId: string; revision: string; config: ShopConfiguration; initialPlans: ShopPublicationJob[]; activatedAt: number; lastCheckAt?: number; issue?: string | null; };
const draftKey = (id: string) => `marketplace.multishop.draft.v1:${id}`;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const destinationId = (target: ShopDestination) => JSON.stringify([target.connectionId, target.warehouseId, target.productId, target.offerId]);

@Injectable()
export class MultishopStockSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MultishopStockSyncService.name);
  private readonly transport = new MultishopStockTransport();
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly groups: MultishopStockGroupsService,
    private readonly marketplace: MarketplaceConnectionsService, private readonly control: MarketplaceStockControlService) {}
  enabled() { return process.env.WMS_MULTISHOP_PUBLICATION_ENABLED === 'true' && process.env.WMS_MULTISHOP_STOCK_ENABLED === 'true'; }
  onModuleInit() { if (this.enabled()) { this.timer = setInterval(() => void this.tick(), 30_000); this.timer.unref(); } }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private authorize(clientId: string, user: AuthUser, write = false) {
    this.groups.authorize(clientId, user, write);
    if (!this.enabled()) throw new BadRequestException('Автоматическая отправка групп не включена на этой установке.');
  }
  private async active(clientId: string) {
    return (await this.prisma.systemSetting.findUnique({ where: { key: MULTISHOP_ACTIVE_PREFIX + clientId } }))?.value as unknown as Active | undefined;
  }
  async status(clientId: string, user: AuthUser) {
    this.authorize(clientId, user);
    const active = await this.active(clientId), jobs = await new MultishopStockQueue(this.prisma).list(clientId);
    return { status: active?.status ?? 'OFF', revision: active?.revision ?? null, lastCheckAt: active?.lastCheckAt ?? null, issue: active?.issue ?? null,
      jobs: jobs.map(j => ({ skuId: j.job.skuId, warehouseId: j.job.warehouseId, status: j.job.status, error: j.error, nextAttemptAt: j.nextAttemptAt })) };
  }

  private async prepare(clientId: string, config: ShopConfiguration) {
    if (!productLinksEnabled(clientId)) throw new BadRequestException('Сначала включите рабочие соответствия карточек WB/Ozon этому клиенту. Каталога только для просмотра недостаточно.');
    await this.control.assertEnabled(clientId);
    const accounts = await this.prisma.clientMarketplaceConnection.findMany({ where: { clientId, isActive: true } });
    if (accounts.some((a, i) => accounts.slice(i + 1).some(b => b.marketplace === a.marketplace && b.apiKey === a.apiKey))) throw new BadRequestException('Найдены дублирующиеся подключения одного кабинета. Устраните дубли перед включением.');
    validateShopGroups(config.groups, config.assignments, accounts.map(a => ({ id: a.id, warehouseId: a.fbsExecutionWarehouseId })));
    const links = await readProductLinks(this.prisma, clientId);
    const destinations: Record<string, ShopDestination> = {}, plans: ShopPublicationJob[] = [], preview: unknown[] = [];
    // FIX: bound the age of the earliest marketplace read, including pagination time.
    const ordersReadAt = Date.now();
    const allOrders: StockOrderLine[] = [];
    const warehouses = new Set(config.groups.map(g => g.warehouseId));
    for (const account of accounts.filter(a => a.fbsExecutionWarehouseId && warehouses.has(a.fbsExecutionWarehouseId))) {
      if (!['WILDBERRIES', 'OZON'].includes(account.marketplace)) throw new BadRequestException('На складе есть другой маркетплейс: его резерв ещё не подключён к общему остатку.');
      const routes = await this.prisma.fbsWarehouseRoutingRule.findMany({ where: { connectionId: account.id } });
      if (routes.some(r => r.mode === 'BRANCH' && r.executionWarehouseId !== account.fbsExecutionWarehouseId)) throw new BadRequestException('У кабинета несколько складов исполнения. Нужна однозначная маршрутизация перед включением группы.');
      if (account.marketplace === 'OZON') {
        for (const posting of await this.transport.ozonPending(account)) allOrders.push(...ozonReservationLines(account.id, posting, links, null));
      } else {
        const raw = await this.marketplace.readMultishopWildberriesOrders(account.id, clientId) as unknown as Record<string, unknown>[];
        for (const order of raw) {
          if (['cancel', 'cancelled', 'canceled', 'cancel_carrier', 'complete', 'delivering', 'delivered'].includes(String(order.supplierStatus)) || ['sold', 'canceled', 'canceled_by_client', 'declined_by_client', 'defect', 'canceled_by_carrier'].includes(String(order.wbStatus))) continue;
          const identity = `${order.nmId}:${order.chrtId}`;
          if (!/^\d+:\d+$/.test(identity) || !/^\d+$/.test(String(order.id))) throw new BadRequestException('WB вернул неполные идентификаторы активного заказа.');
          const candidates = links.filter(l => l.connectionId === account.id && l.marketplace === 'WILDBERRIES' && l.productId === identity && l.status === 'LINKED' && l.skuId);
          if (candidates.length !== 1) throw new BadRequestException('Активный заказ WB не связан однозначно с товаром WMS.');
          allOrders.push({ marketplace: 'WILDBERRIES', connectionId: account.id, orderId: String(order.id), requestId: null, skuId: candidates[0].skuId!, quantity: 1 });
        }
      }
    }
    for (const warehouseId of warehouses) {
      const assignments = config.assignments.filter(a => config.groups.find(g => g.id === a.groupId)!.warehouseId === warehouseId);
      const accountIds = new Set(accounts.filter(a => a.fbsExecutionWarehouseId === warehouseId).map(a => a.id));
      const orders = allOrders.filter(o => accountIds.has(o.connectionId));
      const snapshot = await readSharedStock(this.prisma, clientId, warehouseId, assignments.map(a => a.skuId), orders);
      for (const assignment of assignments) {
        const group = config.groups.find(g => g.id === assignment.groupId)!;
        const quantity = snapshot.quantities.get(assignment.skuId)!;
        const desired: Record<string, number> = {};
        for (const allocation of allocateShopStock(quantity.free, group)) {
          const member = group.members.find(m => m.connectionId === allocation.connectionId)!, account = accounts.find(a => a.id === member.connectionId)!;
          const matches = links.filter(l => l.connectionId === account.id && l.skuId === assignment.skuId && l.status === 'LINKED');
          if (matches.length !== 1) throw new BadRequestException('Для каждого товара нужна одна подтверждённая карточка в каждом выбранном кабинете.');
          const policy = await this.prisma.fbsStockAllocationPolicy.findUnique({ where: { connectionId: account.id } });
          if (policy?.enabled) throw new BadRequestException('Сначала отключите прежнее распределение этого кабинета по складам WB.');
          const target: ShopDestination = { connectionId: account.id, marketplace: account.marketplace as ShopDestination['marketplace'],
            warehouseId: member.marketplaceWarehouseId || account.fbsWarehouseId || '', productId: matches[0].productId, offerId: matches[0].offerId };
          if (!/^\d+$/.test(target.warehouseId)) throw new BadRequestException('Укажите ID склада маркетплейса для каждого выбранного магазина.');
          if (Object.values(destinations).some(d => d.marketplace === target.marketplace && d.productId === target.productId && d.connectionId !== target.connectionId)) throw new BadRequestException('Одна карточка маркетплейса подключена как несколько магазинов. Требуется сверка кабинетов.');
          const id = destinationId(target); destinations[id] = target; desired[id] = allocation.amount;
        }
        plans.push({ id: randomUUID(), revision: digest([group, quantity, links.filter(l => l.skuId === assignment.skuId).map(l => [l.id, l.updatedAt]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]), skuId: assignment.skuId, warehouseId, destinations: Object.keys(desired), desired,
          mode: group.mode ?? 'ALLOCATED', status: 'PENDING', attempts: 0 });
        preview.push({ skuId: assignment.skuId, groupId: group.id, ...quantity, mode: group.mode ?? 'ALLOCATED', safetyReserve: group.safetyReserve ?? 0,
          shops: Object.entries(desired).map(([id, amount]) => ({ connectionId: destinations[id].connectionId, warehouseId: destinations[id].warehouseId, amount })) });
      }
    }
    return { accounts, destinations, plans, preview, allOrders, ordersReadAt };
  }

  async preview(clientId: string, user: AuthUser) {
    this.authorize(clientId, user, true);
    const draft = await this.groups.read(clientId, user);
    if (!draft.revision || !draft.config.assignments.length) throw new BadRequestException('Сначала сохраните группы и назначьте товары.');
    const result = await this.prepare(clientId, draft.config);
    const observations = [];
    for (const [id, target] of Object.entries(result.destinations)) observations.push({ id, amount: await this.transport.observe(result.accounts.find(a => a.id === target.connectionId)!, target) });
    if (observations.some(o => o.amount === null)) throw new BadRequestException('Маркетплейс не подтвердил остаток одной из карточек на выбранном складе. Отправка не включена.');
    const products = await this.prisma.sku.findMany({ where: { clientId, id: { in: draft.config.assignments.map(a => a.skuId) } }, select: { id: true, name: true, article: true, size: true } });
    return { revision: draft.revision, rows: result.preview.map(value => { const row = value as { skuId: string }; const product = products.find(p => p.id === row.skuId); return { ...row, name: product?.name, article: product?.article, size: product?.size }; }), checkedAt: new Date().toISOString() };
  }
  async activate(clientId: string, body: { revision: string }, user: AuthUser) {
    this.authorize(clientId, user, true);
    const draft = await this.groups.read(clientId, user);
    if (!body || draft.revision !== body.revision) throw new ConflictException('Настройки изменились; повторите предпросмотр.');
    if (!draft.config.assignments.length) throw new BadRequestException('Назначьте товары группам перед включением.');
    const prepared = await this.prepare(clientId, draft.config);
    for (const target of Object.values(prepared.destinations)) if (await this.transport.observe(prepared.accounts.find(a => a.id === target.connectionId)!, target) === null) throw new BadRequestException('Маркетплейс не подтвердил остаток карточки. Отправка не включена.');
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${draftKey(clientId)}))`;
      const stored = (await tx.systemSetting.findUnique({ where: { key: draftKey(clientId) } }))?.value as any;
      if (stored?.revision !== body.revision) throw new ConflictException('Настройки изменились; повторите предпросмотр.');
      const key = MULTISHOP_ACTIVE_PREFIX + clientId;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const previous = (await tx.systemSetting.findUnique({ where: { key } }))?.value as unknown as Active | undefined;
      if (previous?.status === 'STOPPING') throw new ConflictException('Дождитесь завершения остановки отправки.');
      const remembered = new Map<string, ShopPublicationJob>();
      for (const plan of [...(previous?.initialPlans ?? []), ...prepared.plans]) {
        const key = JSON.stringify([plan.warehouseId, plan.skuId]), old = remembered.get(key);
        remembered.set(key, { ...plan, destinations: [...new Set([...(old?.destinations ?? []), ...plan.destinations])] });
      }
      const active: Active = { clientId, revision: randomUUID(), config: draft.config, initialPlans: [...remembered.values()], status: 'ACTIVE', activatedAt: Date.now(), destinations: { ...previous?.destinations, ...prepared.destinations } };
      await tx.systemSetting.upsert({ where: { key }, create: { key, value: active as unknown as Prisma.InputJsonValue, updatedByUserId: user.id }, update: { value: active as unknown as Prisma.InputJsonValue, updatedByUserId: user.id } });
      await tx.auditLog.create({ data: { userId: user.id, entity: 'Client', entityId: clientId, action: 'MULTISHOP_ACTIVATED', payload: { revision: active.revision, draftRevision: body.revision } } });
    });
    return this.status(clientId, user);
  }
  async stop(clientId: string, user: AuthUser) {
    this.authorize(clientId, user, true);
    const key = MULTISHOP_ACTIVE_PREFIX + clientId;
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const row = (await tx.systemSetting.findUnique({ where: { key } }))?.value as unknown as Active | undefined;
      if (!row || row.status === 'OFF') return;
      await tx.systemSetting.update({ where: { key }, data: { value: { ...row, status: 'STOPPING', revision: randomUUID() } as unknown as Prisma.InputJsonValue, updatedByUserId: user.id } });
      await tx.auditLog.create({ data: { userId: user.id, entity: 'Client', entityId: clientId, action: 'MULTISHOP_STOP_REQUESTED' } });
    });
    return this.status(clientId, user);
  }

  async tick() {
    if (!this.enabled() || this.running) return;
    this.running = true;
    try {
      const states = await this.prisma.systemSetting.findMany({ where: { key: { startsWith: MULTISHOP_ACTIVE_PREFIX } } });
      for (const row of states) {
        const active = row.value as unknown as Active;
        if (active.status === 'OFF' || Date.now() - active.activatedAt < 120_000) continue;
        try { await this.process(active); }
        catch {
          this.logger.warn('Multi-shop synchronization deferred; no unknown result treated as success.');
          await this.prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${row.key}))`;
            const fresh = (await tx.systemSetting.findUnique({ where: { key: row.key } }))?.value as unknown as Active | undefined;
            if (fresh?.revision !== active.revision) return;
            await tx.systemSetting.update({ where: { key: row.key }, data: { value: { ...fresh, issue: 'Сверка или отправка не завершена. Проверьте предпросмотр: доступы кабинетов, связи товаров и склады. Повтор выполняется автоматически.' } as unknown as Prisma.InputJsonValue } });
          });
        }
      }
    } finally { this.running = false; }
  }
  private async process(active: Active) {
    const clientId = active.clientId, queue = new MultishopStockQueue(this.prisma);
    await this.control.assertEnabled(clientId);
    const prepared = active.status === 'ACTIVE' ? await this.prepare(clientId, active.config) : null;
    const existing = await queue.list(clientId);
    const plans = prepared?.plans ?? [];
    for (const old of [...existing.map(row => row.job), ...active.initialPlans]) if (!plans.some(p => p.skuId === old.skuId && p.warehouseId === old.warehouseId)) plans.push({ ...old, revision: 'zero', desired: {}, status: 'PENDING' });
    for (const plan of plans) await queue.enqueue(clientId, { ...plan, revision: digest([active.revision, plan.revision]) });
    const accounts = prepared?.accounts ?? await this.prisma.clientMarketplaceConnection.findMany({ where: { clientId, isActive: true } });
    const destinations = { ...active.destinations, ...prepared?.destinations };
    if (prepared && Object.keys(prepared.destinations).some(id => !active.destinations[id])) throw new Error('Связи карточек изменились. Требуется повторный предпросмотр и применение.');
    const started = Date.now();
    for (const row of await queue.list(clientId)) {
      if (Date.now() - started > 20_000) break;
      const lease = await queue.claim(row.key); if (!lease) continue;
      let failed = true;
      try {
        const plan = plans.find(p => p.skuId === lease.job.skuId && p.warehouseId === lease.job.warehouseId)!;
        await advanceShopPublication(lease.job, {
          assertLease: () => queue.assertLease(lease),
          current: async () => {
            const fresh = await this.active(clientId);
            if (!fresh || fresh.revision !== active.revision || fresh.status !== active.status) return { revision: 'stale', budget: 0 };
            if (active.status === 'STOPPING' || !Object.keys(plan.desired).length) return { revision: lease.job.revision, budget: 0, mode: lease.job.mode };
            if (Date.now() - prepared!.ordersReadAt > 120_000) throw new Error('Снимок заказов устарел; требуется повторная сверка.');
            const accountIds = new Set(accounts.filter(a => a.fbsExecutionWarehouseId === plan.warehouseId).map(a => a.id));
            const snapshot = await readSharedStock(this.prisma, clientId, plan.warehouseId, [plan.skuId], prepared!.allOrders.filter(o => accountIds.has(o.connectionId)));
            const free = snapshot.quantities.get(plan.skuId)!.free;
            const assignment = active.config.assignments.find(a => a.skuId === plan.skuId)!;
            const group = active.config.groups.find(g => g.id === assignment.groupId)!;
            const expected = allocateShopStock(free, group).map(a => [a.connectionId, a.amount]).sort();
            const planned = Object.entries(plan.desired).map(([id, n]) => [destinations[id].connectionId, n]).sort();
            return { revision: digest(expected) === digest(planned) ? lease.job.revision : 'stale', budget: Math.max(0, free - (group.safetyReserve ?? 0)), mode: group.mode ?? 'ALLOCATED' };
          },
          observe: async ids => {
            const result: Record<string, number | null> = {};
            for (const id of ids) { const target = destinations[id]; if (!target) throw new Error('Не найдено прежнее назначение.'); const account = accounts.find(a => a.id === target.connectionId); if (!account) throw new Error('Кабинет недоступен.'); result[id] = await this.transport.observe(account, target); }
            return result;
          },
          persist: job => queue.persist(lease, job),
          write: async (id, amount) => {
            await this.control.assertEnabled(clientId);
            await queue.assertLease(lease);
            const fresh = await this.active(clientId);
            if (fresh?.revision !== active.revision || fresh.status !== active.status) throw new Error('Настройки отправки изменились.');
            const target = destinations[id];
            if (target.marketplace === 'WILDBERRIES') {
              const catalog = (await this.prisma.systemSetting.findUnique({ where: { key: `marketplace.wbCatalog.${clientId}.${target.connectionId}` } }))?.value as { excluded?: { chrtId: number }[] } | undefined;
              if (catalog && (!Array.isArray(catalog.excluded) || catalog.excluded.some(r => r.chrtId === Number(target.productId.split(':').at(-1))))) throw new Error('Карточка WB ожидает сверки каталога.');
            }
            if (amount > 0) {
              if (!prepared || Date.now() - prepared.ordersReadAt > 120_000) throw new Error('Снимок заказов устарел.');
              const links = await readProductLinks(this.prisma, clientId, target.connectionId);
              if (!links.some(l => l.status === 'LINKED' && l.skuId === plan.skuId && l.productId === target.productId && l.offerId === target.offerId)) throw new Error('Связь карточки изменилась.');
            }
            await this.prisma.auditLog.create({ data: { action: 'MULTISHOP_STOCK_INTENT', entity: 'Client', entityId: clientId, payload: { jobId: lease.job.id, destination: id, amount } } });
            await this.transport.write(accounts.find(a => a.id === destinations[id].connectionId)!, destinations[id], amount);
          },
        });
        failed = false;
      } finally { await queue.release(lease, failed); }
    }
    const remaining = await queue.list(clientId);
    const key = MULTISHOP_ACTIVE_PREFIX + clientId;
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const fresh = (await tx.systemSetting.findUnique({ where: { key } }))?.value as unknown as Active | undefined;
      if (fresh?.revision !== active.revision) return;
      const status = active.status === 'STOPPING' && remaining.every(r => r.job.status === 'DONE' && Object.values(r.job.desired).every(n => n === 0)) ? 'OFF' : active.status;
      await tx.systemSetting.update({ where: { key }, data: { value: { ...fresh, status, destinations, lastCheckAt: Date.now(), issue: remaining.some(r => r.error) ? 'Есть неподтверждённые отправки. Выполняется повторная сверка.' : null } as unknown as Prisma.InputJsonValue } });
    });
  }
}

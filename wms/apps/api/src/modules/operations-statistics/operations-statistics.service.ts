import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { OperationsStatisticsDto } from './operations-statistics.dto';
import { summarizeOrders, type TimingObservation } from './order-timing';

const key = (marketplace: string, connectionId: string, orderId: string) => JSON.stringify([marketplace, connectionId, orderId]);
const DAY = 86_400_000;
export function statisticsPeriod(from: string, to: string) {
  const start = new Date(`${from}T00:00:00+03:00`), end = new Date(`${to}T00:00:00+03:00`);
  const valid = (text: string, date: Date) => /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(+date)
    && new Date(+date + 3 * 3_600_000).toISOString().slice(0, 10) === text;
  if (!valid(from, start) || !valid(to, end) || start > end || +end - +start >= 93 * DAY) {
    throw new BadRequestException('Выберите корректный период до 93 дней включительно.');
  }
  return { start, end: new Date(+end + DAY) };
}

export function observation(placed: Date, shipped: Date | null, category: string | null, now: Date): TimingObservation {
  if (category === 'cancelled') return { state: 'cancelled', elapsedMs: null };
  if (+placed > +now || (shipped && (+shipped < +placed || +shipped > +now))) return { state: 'unknown', elapsedMs: null };
  if (shipped) return { state: 'shipped', elapsedMs: +shipped - +placed };
  if (category === 'active') return { state: 'pending', elapsedMs: +now - +placed };
  return { state: 'unknown', elapsedMs: null };
}

@Injectable()
export class OperationsStatisticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ClientScopeService) private readonly scopes: ClientScopeService) {}

  // FIX: read-only, client- and branch-scoped. Never call marketplace synchronization from a report.
  async report(filter: OperationsStatisticsDto, user: AuthUser) {
    if (user.roleCodes.includes('CLIENT') || user.isDemo) throw new ForbiddenException('Статистика доступна сотрудникам WMS.');
    const period = statisticsPeriod(filter.dateFrom, filter.dateTo), now = new Date();
    const admin = user.permissionCodes.includes('system:admin');
    if (filter.branchId && !admin && !(user.warehouseIds ?? []).includes(filter.branchId)) throw new ForbiddenException('Филиал недоступен.');
    const clientFilter = this.scopes.resolveClientFilter(user, filter.clientId);
    const branchFilter = filter.branchId ? { id: filter.branchId } : admin ? {} : { id: { in: user.warehouseIds ?? [] } };
    const [branches, connections] = await Promise.all([
      this.prisma.warehouse.findMany({ where: { ...branchFilter, isActive: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
      this.prisma.clientMarketplaceConnection.findMany({ where: { clientId: clientFilter, client: { isDemo: false },
        marketplace: filter.marketplace ?? { in: ['WILDBERRIES', 'OZON'] } },
        select: { id: true, clientId: true, marketplace: true, accountName: true, fbsWarehouseId: true, fbsWarehouseName: true,
          fbsExecutionWarehouseId: true, client: { select: { name: true } },
          fbsWarehouseRoutes: { select: { marketplaceWarehouseId: true, marketplaceWarehouseName: true, executionWarehouseId: true } } } }),
    ]);
    const branchIds = branches.map(b => b.id), connectionIds = connections.map(c => c.id);
    const connectionById = new Map(connections.map(c => [c.id, c]));
    type Seller = { id: string; name: string; clientName: string; accountName: string; marketplace: string; orders: TimingObservation[] };
    const groups = new Map(branches.map(b => [b.id, { ...b, orders: [] as TimingObservation[], sellers: new Map<string, Seller>() }]));
    const seller = (branchId: string, connectionId: string, warehouseId: string | null, name: string | null) => {
      const branch = groups.get(branchId), connection = connectionById.get(connectionId);
      if (!branch || !connection) return null;
      const id = JSON.stringify([connectionId, warehouseId]);
      if (!branch.sellers.has(id)) branch.sellers.set(id, { id, name: name || (warehouseId ? `Склад ${warehouseId}` : 'Склад продавца не определён'),
        clientName: connection.client.name, accountName: connection.accountName || '', marketplace: connection.marketplace, orders: [] });
      return branch.sellers.get(id)!;
    };
    for (const c of connections) {
      for (const r of c.fbsWarehouseRoutes) seller(r.executionWarehouseId ?? c.fbsExecutionWarehouseId ?? '', c.id, r.marketplaceWarehouseId, r.marketplaceWarehouseName);
      if (c.fbsWarehouseId && !c.fbsWarehouseRoutes.some(r => r.marketplaceWarehouseId === c.fbsWarehouseId)) {
        seller(c.fbsExecutionWarehouseId ?? '', c.id, c.fbsWarehouseId, c.fbsWarehouseName);
      }
    }
    // WB delivery is recorded per supply. Match its exact order list, not SKU or display number.
    const shipments = new Map<string, { at: Date; warehouseId: string | null; warehouseName: string | null }>();
    let planCursor: string | undefined;
    for (;;) {
      const plans = await this.prisma.fbsSupplyPlan.findMany({ where: { connectionId: { in: connectionIds }, clientId: clientFilter,
        marketplace: 'WILDBERRIES', sentToWbAt: { not: null, gte: period.start, lte: now } },
        select: { id: true, connectionId: true, orderIds: true, sentToWbAt: true, marketplaceWarehouseId: true, marketplaceWarehouseName: true },
        orderBy: { id: 'asc' }, take: 500, ...(planCursor ? { cursor: { id: planCursor }, skip: 1 } : {}) });
      for (const plan of plans) for (const orderId of Array.isArray(plan.orderIds) ? plan.orderIds : []) {
        if (typeof orderId !== 'string' && typeof orderId !== 'number') continue;
        const k = key('WILDBERRIES', plan.connectionId, String(orderId)), previous = shipments.get(k);
        if (!previous || plan.sentToWbAt! < previous.at) shipments.set(k, { at: plan.sentToWbAt!, warehouseId: plan.marketplaceWarehouseId, warehouseName: plan.marketplaceWarehouseName });
      }
      if (plans.length < 500) break;
      planCursor = plans[plans.length - 1].id;
    }
    let cursor: string | undefined, missingOrderDate = 0, lastSyncedAt: Date | null = null;
    const totals: TimingObservation[] = [];
    for (;;) {
      const links = await this.prisma.fbsOrderRequestLink.findMany({ where: {
        clientId: clientFilter, connectionId: { in: connectionIds },
        request: { clientId: clientFilter, client: { isDemo: false }, warehouseId: { in: branchIds } },
        OR: [{ orderPlacedAt: { gte: period.start, lt: period.end } }, { orderPlacedAt: null }],
      }, select: { id: true, marketplace: true, connectionId: true, orderId: true, clientId: true, orderPlacedAt: true, handedOverAt: true,
        sellerWarehouseId: true, sellerWarehouseName: true, lastCategory: true, lastSeenAt: true, createdAt: true,
        request: { select: { warehouseId: true } } }, orderBy: { id: 'asc' }, take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!links.length) break;
      const events = links.some(l => !l.orderPlacedAt) ? await this.prisma.fbsStockMonitorEvent.findMany({ where: { clientId: clientFilter, eventType: 'SALE',
        OR: links.filter(l => !l.orderPlacedAt).map(l => ({ marketplace: l.marketplace, connectionId: l.connectionId, orderId: l.orderId })) },
        select: { marketplace: true, connectionId: true, orderId: true, saleAt: true, marketplaceWarehouseId: true, marketplaceWarehouseName: true }, orderBy: { saleAt: 'asc' } }) : [];
      const origins = new Map<string, typeof events[number]>();
      for (const event of events) { const k = key(event.marketplace, event.connectionId, event.orderId); if (!origins.has(k)) origins.set(k, event); }
      for (const link of links) {
        const k = key(link.marketplace, link.connectionId, link.orderId), origin = origins.get(k);
        const placed = link.orderPlacedAt ?? origin?.saleAt;
        // Unknown dates cannot be assigned to an order-date cohort. Report separately, never fabricate durations.
        if (!placed) { missingOrderDate++; continue; }
        if (placed < period.start || placed >= period.end) continue;
        const shipment = shipments.get(k);
        const row = observation(placed, link.handedOverAt ?? shipment?.at ?? null, link.lastCategory, now);
        const branch = groups.get(link.request.warehouseId!);
        if (!branch) continue;
        const s = seller(branch.id, link.connectionId, link.sellerWarehouseId ?? origin?.marketplaceWarehouseId ?? shipment?.warehouseId ?? null,
          link.sellerWarehouseName ?? origin?.marketplaceWarehouseName ?? shipment?.warehouseName ?? null);
        if (!s) continue;
        branch.orders.push(row); s.orders.push(row); totals.push(row);
        if (link.lastSeenAt && (!lastSyncedAt || link.lastSeenAt > lastSyncedAt)) lastSyncedAt = link.lastSeenAt;
      }
      if (links.length < 500) break;
      cursor = links[links.length - 1].id;
    }
    return { period: { dateFrom: filter.dateFrom, dateTo: filter.dateTo, basis: 'order-created' as const, timezone: 'Europe/Moscow' },
      generatedAt: now.toISOString(), lastSyncedAt: lastSyncedAt?.toISOString() ?? null, missingOrderDate,
      summary: summarizeOrders(totals), branches: [...groups.values()].map(b => ({ id: b.id, name: b.name, summary: summarizeOrders(b.orders),
        warehouses: [...b.sellers.values()].map(({ orders, ...s }) => ({ ...s, summary: summarizeOrders(orders) })) })) };
  }
}

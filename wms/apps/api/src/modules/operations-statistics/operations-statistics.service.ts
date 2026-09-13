import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { OperationsStatisticsDto } from './operations-statistics.dto';
import { summarizeOrders, type TimingObservation } from './order-timing';
import { acceptanceObservation } from './acceptance';

const key = (marketplace: string, connectionId: string, orderId: string) => JSON.stringify([marketplace, connectionId, orderId]);
const DAY = 86_400_000;
type StatisticsConnection = {
  fbsWarehouseId: string | null; fbsExecutionWarehouseId: string | null; fbsAutoRouteNewWarehouses: boolean;
  fbsWarehouseRoutes: { marketplaceWarehouseId: string; mode: string; executionWarehouseId: string | null }[];
};
// FIX: scope follows actual service routing, not a warehouse name or a stale request.
export function servicedBranch(connection: StatisticsConnection, warehouseId: string | null): string | null {
  if (!warehouseId) return null;
  const route = connection.fbsWarehouseRoutes.find(r => r.marketplaceWarehouseId === warehouseId);
  if (route) {
    if (route.mode === 'BRANCH') return route.executionWarehouseId;
    if (route.mode === 'CENTRAL') return connection.fbsExecutionWarehouseId;
    return null; // EXCLUDED and unknown modes fail closed.
  }
  return warehouseId === connection.fbsWarehouseId || connection.fbsAutoRouteNewWarehouses
    ? connection.fbsExecutionWarehouseId : null;
}
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

  // FIX: share identical read scopes with the isolated reporting-cache refresh.
  async scope(filter: OperationsStatisticsDto, user: AuthUser) {
    if (user.roleCodes.includes('CLIENT') || user.isDemo) throw new ForbiddenException('Статистика доступна сотрудникам WMS.');
    const period = statisticsPeriod(filter.dateFrom, filter.dateTo), now = new Date();
    const admin = user.permissionCodes.includes('system:admin');
    if (filter.branchId && !admin && !(user.warehouseIds ?? []).includes(filter.branchId)) throw new ForbiddenException('Филиал недоступен.');
    const clientFilter = this.scopes.resolveClientFilter(user, filter.clientId);
    const branchFilter = filter.branchId ? { id: filter.branchId } : admin ? {} : { id: { in: user.warehouseIds ?? [] } };
    const [branches, connections] = await Promise.all([
      this.prisma.warehouse.findMany({ where: { ...branchFilter, isActive: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
      this.prisma.clientMarketplaceConnection.findMany({ where: { clientId: clientFilter, client: { isDemo: false }, isActive: true,
        marketplace: filter.marketplace ?? { in: ['WILDBERRIES', 'OZON'] } },
        select: { id: true, clientId: true, marketplace: true, accountName: true, fbsWarehouseId: true, fbsWarehouseName: true,
          fbsExecutionWarehouseId: true, fbsAutoRouteNewWarehouses: true, client: { select: { name: true } },
          fbsWarehouseRoutes: { select: { marketplaceWarehouseId: true, marketplaceWarehouseName: true, mode: true, executionWarehouseId: true } } } }),
    ]);
    return { branches, connections, period, now, clientFilter };
  }

  // FIX: read-only; electronic delivery timestamps never substitute marketplace scans.
  async report(filter: OperationsStatisticsDto, user: AuthUser) {
    const { branches, connections, period, now, clientFilter } = await this.scope(filter, user);
    const branchIds = branches.map(b => b.id), connectionIds = connections.map(c => c.id);
    const connectionById = new Map(connections.map(c => [c.id, c]));
    type Seller = { id: string; name: string; clientName: string; accountName: string; marketplace: string; orders: TimingObservation[] };
    const groups = new Map(branches.map(b => [b.id, { ...b, orders: [] as TimingObservation[], sellers: new Map<string, Seller>() }]));
    const seller = (branchId: string, connectionId: string, warehouseId: string | null, name: string | null) => {
      const branch = groups.get(branchId), connection = connectionById.get(connectionId);
      if (!branch || !connection || !groups.has(servicedBranch(connection, warehouseId) ?? '')) return null;
      const id = JSON.stringify([connectionId, warehouseId]);
      if (!branch.sellers.has(id)) branch.sellers.set(id, { id, name: name || (warehouseId ? `Склад ${warehouseId}` : 'Склад продавца не определён'),
        clientName: connection.client.name, accountName: connection.accountName || '', marketplace: connection.marketplace, orders: [] });
      return branch.sellers.get(id)!;
    };
    for (const c of connections) {
      for (const r of c.fbsWarehouseRoutes) seller(servicedBranch(c, r.marketplaceWarehouseId) ?? '', c.id, r.marketplaceWarehouseId, r.marketplaceWarehouseName);
      if (c.fbsWarehouseId && !c.fbsWarehouseRoutes.some(r => r.marketplaceWarehouseId === c.fbsWarehouseId)) {
        seller(c.fbsExecutionWarehouseId ?? '', c.id, c.fbsWarehouseId, c.fbsWarehouseName);
      }
    }
    let cursor: string | undefined, missingOrderDate = 0, lastSyncedAt: Date | null = null, oldestCheckedAt: Date | null = null, uncheckedOrders = 0;
    const totals: TimingObservation[] = [];
    for (;;) {
      const links = await this.prisma.fbsOrderRequestLink.findMany({ where: {
        clientId: clientFilter, connectionId: { in: connectionIds },
        request: { clientId: clientFilter, client: { isDemo: false }, warehouseId: { in: branchIds } },
        OR: [{ orderPlacedAt: { gte: period.start, lt: period.end } }, { orderPlacedAt: null }],
      }, select: { id: true, marketplace: true, connectionId: true, orderId: true, clientId: true, orderPlacedAt: true, handedOverAt: true,
        sellerWarehouseId: true, sellerWarehouseName: true, lastCategory: true, lastSupplierStatus: true, lastWbStatus: true, lastSupplyId: true, lastSeenAt: true, createdAt: true,
        request: { select: { warehouseId: true } } }, orderBy: { id: 'asc' }, take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!links.length) break;
      const facts = await this.prisma.operationsStatisticsFact.findMany({ where: { clientId: clientFilter,
        OR: links.map(l => ({ marketplace: l.marketplace, connectionId: l.connectionId, orderId: l.orderId })) } });
      const factByKey = new Map(facts.map(f => [key(f.marketplace, f.connectionId, f.orderId), f]));
      const events = links.some(l => !l.orderPlacedAt || !l.sellerWarehouseId) ? await this.prisma.fbsStockMonitorEvent.findMany({ where: { clientId: clientFilter, eventType: 'SALE',
        OR: links.filter(l => !l.orderPlacedAt || !l.sellerWarehouseId).map(l => ({ marketplace: l.marketplace, connectionId: l.connectionId, orderId: l.orderId })) },
        select: { marketplace: true, connectionId: true, orderId: true, saleAt: true, marketplaceWarehouseId: true, marketplaceWarehouseName: true }, orderBy: { saleAt: 'asc' } }) : [];
      const origins = new Map<string, typeof events[number]>();
      for (const event of events) { const k = key(event.marketplace, event.connectionId, event.orderId); if (!origins.has(k)) origins.set(k, event); }
      for (const link of links) {
        const k = key(link.marketplace, link.connectionId, link.orderId), origin = origins.get(k);
        const fact = factByKey.get(k);
        const warehouseId = fact?.sellerWarehouseId ?? link.sellerWarehouseId ?? origin?.marketplaceWarehouseId ?? null;
        const connection = connectionById.get(link.connectionId);
        if (!connection || !groups.has(servicedBranch(connection, warehouseId) ?? '')) continue;
        // Ozon in_process_at is not the buyer's order creation time. Do not mix it into this KPI.
        const placed = fact?.orderPlacedAt ?? (link.marketplace === 'WILDBERRIES' ? link.orderPlacedAt ?? origin?.saleAt : null);
        // Unknown dates cannot be assigned to an order-date cohort. Report separately, never fabricate durations.
        if (!placed) { missingOrderDate++; continue; }
        if (placed < period.start || placed >= period.end) continue;
        const newerLink = !!fact && !!link.lastSeenAt && link.lastSeenAt > fact.checkedAt;
        const supplyChanged = newerLink && link.lastSupplyId !== fact?.supplyId;
        const row = acceptanceObservation(placed, {
          supplierStatus: newerLink ? link.lastSupplierStatus : fact?.supplierStatus ?? link.lastSupplierStatus,
          wbStatus: newerLink ? link.lastWbStatus : fact?.wbStatus ?? link.lastWbStatus,
          requiresReshipment: fact?.requiresReshipment,
          supplyScannedAt: supplyChanged ? null : fact?.supplyScannedAt,
        }, now);
        const branch = groups.get(link.request.warehouseId!);
        if (!branch) continue;
        // FIX: a fresh warehouse ID must never inherit another warehouse's stale label.
        const warehouseName = connection.fbsWarehouseRoutes.find(r => r.marketplaceWarehouseId === warehouseId)?.marketplaceWarehouseName
          ?? (connection.fbsWarehouseId === warehouseId ? connection.fbsWarehouseName : null)
          ?? (link.sellerWarehouseId === warehouseId ? link.sellerWarehouseName : null)
          ?? (origin?.marketplaceWarehouseId === warehouseId ? origin.marketplaceWarehouseName : null);
        const s = seller(branch.id, link.connectionId, warehouseId,
          warehouseName);
        if (!s) continue;
        branch.orders.push(row); s.orders.push(row); totals.push(row);
        if (!fact) uncheckedOrders++;
        if (fact && (!oldestCheckedAt || fact.checkedAt < oldestCheckedAt)) oldestCheckedAt = fact.checkedAt;
        if (fact && (!lastSyncedAt || fact.checkedAt > lastSyncedAt)) lastSyncedAt = fact.checkedAt;
      }
      if (links.length < 500) break;
      cursor = links[links.length - 1].id;
    }
    return { period: { dateFrom: filter.dateFrom, dateTo: filter.dateTo, basis: 'order-created' as const, timezone: 'Europe/Moscow' },
      generatedAt: now.toISOString(), lastSyncedAt: lastSyncedAt?.toISOString() ?? null, oldestCheckedAt: oldestCheckedAt?.toISOString() ?? null,
      uncheckedOrders, missingOrderDate, timingDefinition: 'marketplace-acceptance' as const,
      summary: summarizeOrders(totals), branches: [...groups.values()].filter(b => b.sellers.size > 0).map(b => ({ id: b.id, name: b.name, summary: summarizeOrders(b.orders),
        warehouses: [...b.sellers.values()].map(({ orders, ...s }) => ({ ...s, summary: summarizeOrders(orders) })) })) };
  }
}

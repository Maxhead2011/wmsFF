import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { marketplaceJson } from '../marketplace-connections/marketplace-connections.service';
import { runWithWildberriesRequestPriority } from '../marketplace-connections/wildberries-request-scheduler';
import { OperationsStatisticsDto } from './operations-statistics.dto';
import { OperationsStatisticsService, servicedBranch } from './operations-statistics.service';
import { validDate } from './order-timing';

type Job = { id: string; status: 'running' | 'complete' | 'partial' | 'failed'; ordersUpdated: number; connectionsDone: number;
  errors: string[]; startedAt: string; finishedAt: string | null };
const accessKey = (u: AuthUser) => JSON.stringify([u.id, u.isDemo, u.roleCodes, u.permissionCodes, u.clientScopeMode, u.clientIds, u.hiddenClientIds, u.warehouseIds]);
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown) => typeof v === 'string' || typeof v === 'number' ? String(v) : '';
function rows(v: unknown) {
  if (!Array.isArray(v)) throw new Error('Неполный ответ WB');
  return v.map(record);
}

@Injectable()
export class StatisticsRefreshService {
  private readonly jobs = new Map<string, { owner: string; job: Job }>();
  private running = false;
  private lastStarted = 0;
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OperationsStatisticsService) private readonly statistics: OperationsStatisticsService) {}

  // FIX: POST starts bounded read-only marketplace work; GET report never calls WB.
  async start(filter: OperationsStatisticsDto, user: AuthUser) {
    const scope = await this.statistics.scope(filter, user);
    if (filter.marketplace === 'OZON') throw new BadRequestException('Для Ozon источник точного времени приёмки пока не подключён.');
    if (this.running || Date.now() - this.lastStarted < 60_000) throw new ConflictException('Обновление уже выполняется или недавно запускалось. Повторите через минуту.');
    const job: Job = { id: randomUUID(), status: 'running', ordersUpdated: 0, connectionsDone: 0, errors: [], startedAt: new Date().toISOString(), finishedAt: null };
    // Short-lived progress contains no keys, customer payloads or inventory data.
    for (const [id, value] of this.jobs) if (+new Date(value.job.startedAt) < Date.now() - 3600_000) this.jobs.delete(id);
    if (this.jobs.size >= 20) this.jobs.delete(this.jobs.keys().next().value!);
    this.jobs.set(job.id, { owner: accessKey(user), job });
    this.running = true; this.lastStarted = Date.now();
    void runWithWildberriesRequestPriority('background', () => this.run(scope, job)).catch(() => { job.errors.push('Обновление прервано. Повторите запрос.'); job.status = 'failed'; })
      .finally(() => { job.finishedAt = new Date().toISOString(); this.running = false; });
    return { ...job, errors: [...job.errors] };
  }

  progress(id: string, user: AuthUser) {
    const entry = this.jobs.get(id);
    if (!entry) throw new NotFoundException('Обновление не найдено или сервер перезапущен. Запустите обновление ещё раз.');
    if (entry.owner !== accessKey(user)) throw new ForbiddenException('Обновление недоступно.');
    return { ...entry.job, errors: [...entry.job.errors] };
  }

  private async run(scope: Awaited<ReturnType<OperationsStatisticsService['scope']>>, job: Job) {
    const deadline = Date.now() + 10 * 60_000;
    const branchIds = scope.branches.map(b => b.id);
    const read = async (path: string, token: string, body?: unknown) => {
      if (Date.now() >= deadline) throw new Error('Время обновления истекло');
      return marketplaceJson(`https://marketplace-api.wildberries.ru${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
      });
    };
    for (const connection of scope.connections) {
      if (connection.marketplace !== 'WILDBERRIES') continue;
      if (!branchIds.includes(connection.fbsExecutionWarehouseId ?? '') && !connection.fbsWarehouseRoutes.some(r => branchIds.includes(servicedBranch(connection, r.marketplaceWarehouseId) ?? ''))) continue;
      try {
        const credential = await this.prisma.clientMarketplaceConnection.findFirst({ where: { id: connection.id, clientId: connection.clientId, isActive: true }, select: { apiKey: true } });
        if (!credential) continue;
        const token = credential.apiKey;
        const repeated = new Set(rows((await read('/api/v3/supplies/orders/reshipment', token)).orders).map(o => str(o.orderID)));
        const scans = new Map<string, { at: Date | null; issue: string | null }>();
        const seenOrders = new Set<string>();
        const end = Math.min(+scope.period.end, Date.now());
        // WB permits at most 30 days in one request. Pages are consumed completely, or explicitly reported partial.
        for (let from = +scope.period.start; from < end; from += 30 * 86400_000) {
          let next = '0'; const cursors = new Set<string>(); let finished = false;
          for (let page = 0; page < 100; page++) {
            const query = new URLSearchParams({ limit: '1000', next, dateFrom: String(Math.floor(from / 1000)), dateTo: String(Math.floor(Math.min(from + 30 * 86400_000, end) / 1000) - 1) });
            const payload = await read(`/api/v3/orders?${query}`, token);
            const orders = rows(payload.orders);
            const candidates = [...new Map(orders.filter(o => o.deliveryType === 'fbs' && Number.isSafeInteger(Number(o.id)) && Number(o.id) > 0
              && branchIds.includes(servicedBranch(connection, str(o.warehouseId)) ?? '')).map(o => [str(o.id), o])).values()];
            const links = candidates.length ? await this.prisma.fbsOrderRequestLink.findMany({ where: {
              marketplace: 'WILDBERRIES', connectionId: connection.id, clientId: connection.clientId,
              orderId: { in: candidates.map(o => str(o.id)) }, request: { clientId: connection.clientId, client: { isDemo: false }, warehouseId: { in: branchIds } },
            }, select: { orderId: true } }) : [];
            const allowed = new Set(links.map(l => l.orderId));
            const selected = candidates.filter(o => allowed.has(str(o.id)) && !seenOrders.has(str(o.id)));
            const statusRows = selected.length ? rows((await read('/api/v3/orders/status', token, { orders: selected.map(o => Number(o.id)) })).orders) : [];
            const statuses = new Map(statusRows.map(o => [str(o.id), o]));
            for (const order of selected) {
              if (Date.now() >= deadline) throw new Error('Время обновления истекло');
              const orderId = str(order.id), supplyId = str(order.supplyId), placed = validDate(str(order.createdAt));
              if (!placed) { job.errors.push(`WB не вернул дату создания заказа ${orderId}.`); continue; }
              if (+placed < +scope.period.start || +placed >= +scope.period.end) continue;
              const status = statuses.get(orderId);
              if (supplyId && !scans.has(supplyId)) {
                try {
                  const supply = await read(`/api/v3/supplies/${encodeURIComponent(supplyId)}`, token);
                  if (str(supply.id) !== supplyId) throw new Error('Несовпадение поставки');
                  scans.set(supplyId, { at: validDate(str(supply.scanDt)), issue: null });
                } catch { scans.set(supplyId, { at: null, issue: 'SUPPLY_SCAN_UNAVAILABLE' }); job.errors.push(`Не удалось проверить скан поставки ${supplyId}.`); }
              }
              const scan = scans.get(supplyId);
              const data = { clientId: connection.clientId, marketplace: connection.marketplace, connectionId: connection.id, orderId,
                orderPlacedAt: placed, sellerWarehouseId: str(order.warehouseId), supplyId: supplyId || null,
                supplyScannedAt: scan?.at ?? null, supplierStatus: str(status?.supplierStatus) || null, wbStatus: str(status?.wbStatus) || null,
                requiresReshipment: repeated.has(orderId), checkedAt: new Date(), issue: !status ? 'ORDER_STATUS_UNAVAILABLE' : scan?.issue ?? null };
              await this.prisma.operationsStatisticsFact.upsert({ where: { marketplace_connectionId_orderId: { marketplace: connection.marketplace, connectionId: connection.id, orderId } }, create: data, update: data });
              if (!status) job.errors.push(`WB не вернул статус заказа ${orderId}.`);
              seenOrders.add(orderId); job.ordersUpdated++;
            }
            const following = str(payload.next);
            if (!orders.length || following === '0') { finished = true; break; }
            if (!following || following === next || cursors.has(following)) throw new Error('Неполная пагинация WB');
            cursors.add(next); next = following;
          }
          if (!finished) throw new Error('Превышен объём обновления; сузьте период');
        }
        job.connectionsDone++;
      } catch {
        // Do not expose upstream payloads: they can contain credentials or customer details.
        job.errors.push(`Кабинет ${connection.accountName || connection.client.name}: обновление неполное. Проверьте доступ WB и повторите для меньшего периода.`);
      }
      if (Date.now() >= deadline) { job.errors.push('Достигнут лимит времени обновления. Сузьте период.'); break; }
    }
    job.status = job.errors.length ? (job.ordersUpdated ? 'partial' : 'failed') : 'complete';
  }
}

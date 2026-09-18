import { ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { MarketplaceStockControlService } from './marketplace-stock-control.service';
import { evaluateWbSyncProof, nextWbHealthState, WB_HEALTH_HOUR } from './wb-sync-health.rules';

const PREFIX = 'monitor.wbSync.';
type Proof = ReturnType<typeof evaluateWbSyncProof>;
type Cycle = { id: string; startedAt: string; finishedAt: string | null; orders: string; billing: string;
  error: string | null; connections: Array<{ id: string; warehouseId: string | null; proof: Proof }> };
type State = { clientId: string; cycles: Cycle[]; incidentAt: string | null; failures: number; nextCheckAt: string;
  checkedCycleId: string | null; lastSuccessAt: string | null; checkedAt: string | null };

// FIX: only persist bounded operational facts, never API credentials or raw exception payloads.
export function wbHealthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/expired transaction|Transaction already closed/i.test(message)) return 'Тайм-аут транзакции ВМС';
  if (/INT4/i.test(message)) return 'Переполнение INT4';
  return 'Ошибка обработки; требуется проверка серверного журнала';
}

@Injectable()
export class WbSyncHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WbSyncHealthService.name);
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService,
    private readonly stockControl: MarketplaceStockControlService) {}
  get enabled() { return process.env.WMS_WB_SYNC_HEALTH_ENABLED === 'true'; }
  onModuleInit() {
    if (!this.enabled) return;
    this.timer = setInterval(() => { void this.tick(); }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private initial(clientId: string): State {
    return { clientId, cycles: [], incidentAt: null, failures: 0, nextCheckAt: new Date(Date.now() + WB_HEALTH_HOUR).toISOString(),
      checkedCycleId: null, lastSuccessAt: null, checkedAt: null };
  }

  // FIX: separate observer failures from order refresh and all financial transactions.
  async begin(clientId: string): Promise<Cycle | undefined> {
    if (!this.enabled) return;
    try {
      if (!await this.stockControl.isEnabled(clientId)) return;
      const count = await this.prisma.clientMarketplaceConnection.count({ where: { clientId, isActive: true, marketplace: 'WILDBERRIES' } });
      if (!count) return;
      const cycle: Cycle = { id: randomUUID(), startedAt: new Date().toISOString(), finishedAt: null, orders: 'В работе', billing: 'Ожидание', error: null, connections: [] };
      await this.save(clientId, state => { state.cycles = [cycle, ...state.cycles].slice(0, 20); });
      return cycle;
    } catch { this.logger.warn('WB cycle observer could not persist start'); }
  }

  async finish(clientId: string, cycle?: Cycle) {
    if (!cycle || !this.enabled) return;
    try {
      cycle.finishedAt = new Date().toISOString();
      const connections = await this.prisma.clientMarketplaceConnection.findMany({ where: { clientId, isActive: true, marketplace: 'WILDBERRIES' },
        select: { id: true, fbsExecutionWarehouseId: true } });
      for (const connection of connections) {
        const rows = await this.prisma.wbStockPublicationCheck.findMany({ where: { connectionId: connection.id },
          select: { runId: true, status: true, phase: true, calculatedAmount: true, observedAmount: true, updatedAt: true, error: true } });
        cycle.connections.push({ id: connection.id, warehouseId: connection.fbsExecutionWarehouseId, proof: evaluateWbSyncProof(rows, new Date(cycle.startedAt)) });
      }
      await this.save(clientId, async (state, tx) => {
        state.cycles = [cycle, ...state.cycles.filter(item => item.id !== cycle.id)].slice(0, 20);
        if (state.incidentAt || !state.checkedAt || Date.parse(state.nextCheckAt) <= Date.now()) await this.evaluate(state, tx, cycle);
      });
    } catch { this.logger.warn('WB cycle observer could not persist completion'); }
  }

  private async save(clientId: string, change: (state: State, tx: Prisma.TransactionClient) => void | Promise<void>) {
    const key = PREFIX + clientId;
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const row = await tx.systemSetting.findUnique({ where: { key } });
      const state = row ? row.value as unknown as State : this.initial(clientId);
      await change(state, tx);
      const value = state as unknown as Prisma.InputJsonValue;
      await tx.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }, { timeout: 10_000 });
  }

  private async evaluate(state: State, tx: Prisma.TransactionClient, cycle?: Cycle) {
    const now = new Date();
    const fresh = cycle?.finishedAt && Date.parse(cycle.finishedAt) >= now.getTime() - WB_HEALTH_HOUR;
    const success = Boolean(fresh && !cycle!.error && cycle!.orders === 'Завершено' && cycle!.billing === 'Завершено'
      && cycle!.connections.length && cycle!.connections.every(connection => connection.proof.success));
    // FIX: one unfinished or stale cycle never increments the failed-cycle counter repeatedly.
    if (state.incidentAt && state.checkedCycleId === (cycle?.id ?? null)) return;
    const previousIncident = state.incidentAt;
    Object.assign(state, nextWbHealthState(state, !success, now));
    state.checkedAt = now.toISOString();
    state.checkedCycleId = cycle?.id ?? null;
    if (success) state.lastSuccessAt = cycle!.finishedAt;
    if (!success || previousIncident) {
      const connections = await tx.clientMarketplaceConnection.findMany({ where: { clientId: state.clientId, isActive: true, marketplace: 'WILDBERRIES' }, select: { fbsExecutionWarehouseId: true } });
      const client = await tx.client.findUnique({ where: { id: state.clientId }, select: { name: true, isDemo: true } });
      for (const warehouseId of new Set(connections.map(connection => connection.fbsExecutionWarehouseId))) {
        const incident = state.incidentAt ?? previousIncident;
        const dedupeKey = `wb-sync:${state.clientId}:${warehouseId ?? 'global'}:${incident}`;
        const body = success ? 'Синхронизация восстановлена. Следующая проверка через час.'
          : `${client?.name ?? 'Клиент'}: ${fresh ? 'цикл завершён с проблемой' : 'нет свежего завершённого цикла'}. Проверок с ошибкой: ${state.failures}. Мониторинг → Синхронизация WB.`;
        const title = success ? 'WB: проблема устранена' : 'WB: требуется проверка синхронизации';
        await tx.adminNotification.upsert({ where: { dedupeKey }, update: { title, body },
          create: { dedupeKey, type: 'WB_SYNC_HEALTH', title, body, clientId: state.clientId, warehouseId,
            actorId: 'system', actorName: 'Контроль синхронизации WB', isDemo: client?.isDemo ?? false } });
      }
    }
  }

  async tick() {
    if (!this.enabled || this.ticking) return;
    this.ticking = true;
    try {
      const clients = await this.prisma.clientMarketplaceConnection.findMany({ where: { isActive: true, marketplace: 'WILDBERRIES' }, distinct: ['clientId'], select: { clientId: true } });
      for (const { clientId } of clients) {
        if (!await this.stockControl.isEnabled(clientId)) continue;
        await this.save(clientId, async (state, tx) => {
          if (Date.parse(state.nextCheckAt) > Date.now()) return;
          await this.evaluate(state, tx, state.cycles.find(cycle => cycle.finishedAt));
        });
      }
    } catch { this.logger.warn('WB hourly health check failed; will retry'); }
    finally { this.ticking = false; }
  }

  async list(user: AuthUser) {
    if (!user.permissionCodes.includes('system:admin') && !user.roleCodes.some(role => ['ADMIN', 'OWNER'].includes(role))) throw new ForbiddenException('Только для администратора.');
    if (!this.enabled) return { enabled: false, items: [] };
    const clientId = this.scopes.resolveClientFilter(user);
    // FIX: branch and demo scopes apply before loading operational details.
    const clients = await this.prisma.client.findMany({ where: { ...(clientId ? { id: clientId } : {}), isDemo: user.isDemo ?? false,
      ...(!user.permissionCodes.includes('system:admin') || user.warehouseIds?.length
        ? { warehouseLinks: { some: { warehouseId: { in: user.warehouseIds ?? [] } } } } : {}) }, select: { id: true, name: true } });
    const items = [];
    for (const client of clients) {
      const row = await this.prisma.systemSetting.findUnique({ where: { key: PREFIX + client.id } });
      if (row) items.push({ clientName: client.name, ...(row.value as unknown as State), active: await this.stockControl.isEnabled(client.id) });
    }
    return { enabled: true, items };
  }
}

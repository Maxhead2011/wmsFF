import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../common/prisma/prisma.service';

export const urgentWbStockSyncEnabled = () => process.env.WMS_WB_URGENT_STOCK_SYNC === 'true';
type Scope = { clientId: string; snapshot?: string; capturedAt?: number; pools?: Map<number, Set<string>> };
type UrgentContext = { skuIds: string[] | null; guard?: () => Promise<void>; unconfirmed: Set<string>; retryAll: boolean };
export const urgentWbSkuIds = () => urgent.getStore()?.skuIds ?? null;
const plans = new AsyncLocalStorage<Scope>();
const urgent = new AsyncLocalStorage<UrgentContext>();
export const inWbStockPlan = (clientId: string) => plans.getStore()?.clientId === clientId;
export const isUrgentWbStockSync = () => urgent.getStore() !== undefined;
// FIX: missing WB observations are incomplete work, even when known targets succeeded.
// Keep identities only: the next attempt must calculate new quantities from WMS.
export function deferUnconfirmedWbStock(targets: Array<{ skuId?: string }>) {
  const context = urgent.getStore();
  if (!context || !urgentWbStockSyncEnabled()) return;
  for (const target of targets) {
    if (target.skuId) context.unconfirmed.add(target.skuId);
    else context.retryAll = true;
  }
}
export class StaleWbStockPlan extends Error {
  constructor() { super('Остатки или заказы изменились. Старый расчёт не отправлен; выполняется повторная синхронизация.'); }
}

export async function stockRevision(db: PrismaService): Promise<string> {
  const rows = await db.$queryRaw<Array<{ snapshot: string }>>`SELECT txid_current_snapshot()::text AS snapshot`;
  return rows[0].snapshot;
}

// FIX: each calculation owns its revision; parallel requests never share mutable plan state.
export function withWbStockPlan<T>(clientId: string, action: () => Promise<T>): Promise<T> {
  if (!urgentWbStockSyncEnabled() || plans.getStore()?.clientId === clientId) return action();
  return plans.run({ clientId }, action);
}
export async function captureWbStockPlan(db: PrismaService, clientId: string) {
  if (!urgentWbStockSyncEnabled()) return;
  const scope = plans.getStore();
  if (!scope || scope.clientId !== clientId) return; // Read-only screens do not publish.
  if (scope.snapshot === undefined) { scope.snapshot = await stockRevision(db); scope.capturedAt = Date.now(); }
}
// FIX: capture complete relabel pools so unrelated SKU activity does not invalidate a send.
export function registerWbStockPlan(quantities: Map<string, { chrtId: number }>, meta: Map<string, { sources?: Array<{ skuId: string }> }>) {
  const scope = plans.getStore();
  if (!scope) return;
  scope.pools ??= new Map();
  for (const [skuId, value] of quantities) {
    const pool = expandWbStockScope([skuId], meta);
    const existing = scope.pools.get(value.chrtId) ?? new Set<string>();
    pool.forEach(id => existing.add(id)); scope.pools.set(value.chrtId, existing);
  }
}
export async function assertFreshWbStockPlan(db: PrismaService, clientId: string, chrtIds?: number[]) {
  if (!urgentWbStockSyncEnabled()) return;
  const scope = plans.getStore();
  if (!scope || scope.clientId !== clientId || !scope.snapshot || Date.now() - scope.capturedAt! > 1_200_000) throw new StaleWbStockPlan();
  await urgent.getStore()?.guard?.();
  const ids = new Set<string>();
  // Unknown mappings fail closed by validating all events, never by ignoring a size.
  const scoped = chrtIds?.length && chrtIds.every(id => scope.pools?.has(id));
  if (scoped) chrtIds!.forEach(id => scope.pools!.get(id)!.forEach(sku => ids.add(sku)));
  const rows = await db.$queryRaw<Array<{ stale: boolean }>>`SELECT EXISTS (
    SELECT 1 FROM "WbStockSyncEvent" WHERE "clientId" = ${clientId}
      AND txid >= txid_snapshot_xmin(${scope.snapshot}::txid_snapshot)
      AND NOT txid_visible_in_snapshot(txid, ${scope.snapshot}::txid_snapshot)
      AND (${!scoped} OR "allSkus" OR "skuIds" && ${[...ids]}::text[])
  ) AS stale`;
  if (rows[0]?.stale !== false) throw new StaleWbStockPlan();
}

export const wbStockRetryDelay = (attempt: number) => Math.min(300_000, 5_000 * 2 ** Math.min(6, Math.max(0, attempt - 1)));
type Job = { clientId: string; attempts: number };
type Event = { id: bigint; skuIds: string[]; allSkus: boolean };

// FIX: a committed database event survives restart; one lease coalesces a client's changes.
export class WbStockSyncWorker {
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;
  constructor(private readonly db: PrismaService, private readonly sync: (clientId: string) => Promise<void>, private readonly warn: (message: string) => void) {}
  start() { if (urgentWbStockSyncEnabled()) this.schedule(); }
  async stop() { this.stopped = true; clearTimeout(this.timer); await this.running; }
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().catch(() => this.warn('Очередь остатков WB: проверка не завершена; будет повторена.')).finally(() => { this.running = undefined; this.schedule(); });
    }, 2000);
    this.timer.unref?.();
  }
  async tick() {
    if (!urgentWbStockSyncEnabled()) return;
    const token = randomUUID();
    // Queue rows are owned only by workers; business transactions merely append events.
    await this.db.$executeRaw`INSERT INTO "WbStockSyncQueue" ("clientId")
      SELECT DISTINCT "clientId" FROM "WbStockSyncEvent" WHERE "processedAt" IS NULL
      ON CONFLICT ("clientId") DO NOTHING`;
    const rows = await this.db.$queryRaw<Job[]>`UPDATE "WbStockSyncQueue" q SET "leaseToken" = ${token}, "leaseUntil" = now() + interval '60 seconds'
      WHERE q."clientId" = (SELECT "clientId" FROM "WbStockSyncQueue" c WHERE "nextAttemptAt" <= now()
        AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
        AND EXISTS (SELECT 1 FROM "WbStockSyncEvent" e WHERE e."clientId" = c."clientId" AND e."processedAt" IS NULL)
        ORDER BY "nextAttemptAt", "requestedAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING "clientId", attempts`;
    const job = rows[0];
    if (!job) return;
    const events = await this.db.$queryRaw<Event[]>`SELECT id, "skuIds", "allSkus" FROM "WbStockSyncEvent"
      WHERE "clientId" = ${job.clientId} AND "processedAt" IS NULL ORDER BY id LIMIT 5000`;
    const eventIds = events.map(e => e.id);
    const skuIds = events.some(e => e.allSkus) ? null : [...new Set(events.flatMap(e => e.skuIds))];
    let leaseLost = false;
    const renew = async () => {
      const count = await this.db.$executeRaw`UPDATE "WbStockSyncQueue" SET "leaseUntil" = now() + interval '60 seconds'
        WHERE "clientId" = ${job.clientId} AND "leaseToken" = ${token} AND "leaseUntil" > now()`;
      if (count !== 1) leaseLost = true;
      if (leaseLost) throw new StaleWbStockPlan();
    };
    const heartbeat = setInterval(() => { void renew().catch(() => { leaseLost = true; }); }, 15_000);
    heartbeat.unref?.();
    const record = (phase: string, details: Record<string, unknown> = {}) => this.db.auditLog.create({ data: {
      action: 'WB_STOCK_URGENT_SYNC', entity: 'Client', entityId: job.clientId,
      payload: { phase, eventCount: events.length, lastEventId: events.at(-1)?.id.toString(), ...details } as any,
    } });
    try {
      await record('STARTED');
      const context: UrgentContext = { skuIds, guard: renew, unconfirmed: new Set(), retryAll: false };
      await urgent.run(context, () => this.sync(job.clientId));
      await renew();
      const retrySkuIds = [...context.unconfirmed].sort();
      const partial = context.retryAll || retrySkuIds.length > 0;
      const message = partial ? 'Часть остатков WB не подтверждена. Неподтверждённые товары сохранены для повторного расчёта и проверки.' : null;
      // FIX: acknowledge only events observed before this calculation. A late commit stays pending,
      // even if its sequence ID was allocated before newer already-processed transactions.
      await this.db.$transaction(async tx => {
        const owned = await tx.$executeRaw`UPDATE "WbStockSyncQueue" SET attempts = ${partial ? job.attempts + 1 : 0}, "lastError" = ${message},
          "nextAttemptAt" = now() + (${partial ? wbStockRetryDelay(job.attempts + 1) : 0} * interval '1 millisecond'), "leaseToken" = NULL, "leaseUntil" = NULL
          WHERE "clientId" = ${job.clientId} AND "leaseToken" = ${token} AND "leaseUntil" > now()`;
        if (owned !== 1) throw new StaleWbStockPlan();
        // FIX: replace observed work with its unconfirmed subset atomically. Concurrent
        // business events are untouched; a crash cannot lose the pending subset.
        if (partial) {
          await tx.$executeRaw`INSERT INTO "WbStockSyncEvent" ("clientId", "skuIds", "allSkus")
            VALUES (${job.clientId}, ${retrySkuIds}::text[], ${context.retryAll})`;
          await tx.fbsStockAllocationPolicy.updateMany({ where: { clientId: job.clientId, enabled: true }, data: { lastError: message } });
        }
        await tx.$executeRaw`UPDATE "WbStockSyncEvent" SET "processedAt" = now() WHERE id = ANY(${eventIds}::bigint[])`;
        await tx.auditLog.create({ data: { action: 'WB_STOCK_URGENT_SYNC', entity: 'Client', entityId: job.clientId,
          payload: { phase: partial ? 'PARTIAL_RETRY_REQUIRED' : 'PROCESSED', eventCount: events.length,
            ...(partial ? { retrySkuIds, retryAll: context.retryAll, message } : {}) } } });
      });
      if (message) this.warn(message);
    } catch (error) {
      const stale = error instanceof StaleWbStockPlan;
      const message = stale ? error.message : 'Синхронизация WB не подтверждена. Следующая попытка выполнит новый расчёт и проверку.';
      const owned = await this.db.$executeRaw`UPDATE "WbStockSyncQueue" SET attempts = attempts + 1, "lastError" = ${message},
        "nextAttemptAt" = now() + (${stale ? 2000 : wbStockRetryDelay(job.attempts + 1)} * interval '1 millisecond'),
        "leaseToken" = NULL, "leaseUntil" = NULL WHERE "clientId" = ${job.clientId} AND "leaseToken" = ${token}`;
      if (owned !== 1) return; // A replacement worker owns the result; do not overwrite its warning.
      // FIX: the existing allocation screen exposes this warning until a verified run clears it.
      await this.db.fbsStockAllocationPolicy.updateMany({ where: { clientId: job.clientId, enabled: true }, data: { lastError: message } });
      await record(stale ? 'RECALCULATE' : 'RETRY_REQUIRED', { message });
      this.warn(message);
    } finally {
      clearInterval(heartbeat);
    }
  }
}

// FIX: recalculate the complete shared pool, but send only changed SKUs and their relabel peers.
export function urgentWbStockScope(meta: Map<string, { sources?: Array<{ skuId: string }> }>): Set<string> | null {
  const changed = urgentWbSkuIds();
  if (!changed) return null;
  return expandWbStockScope(changed, meta);
}
export function expandWbStockScope(changed: string[], meta: Map<string, { sources?: Array<{ skuId: string }> }>): Set<string> {
  const result = new Set(changed);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const [target, info] of meta) {
      const pool = [target, ...(info.sources ?? []).map(s => s.skuId)];
      if (!pool.some(id => result.has(id))) continue;
      for (const id of pool) if (!result.has(id)) { result.add(id); expanded = true; }
    }
  }
  return result;
}

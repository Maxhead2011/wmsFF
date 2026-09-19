import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../common/prisma/prisma.service';

export const urgentWbStockSyncEnabled = () => process.env.WMS_WB_URGENT_STOCK_SYNC === 'true';
type Scope = { clientId: string; revision?: bigint };
type UrgentContext = { skuIds: string[] | null; guard?: () => Promise<void> };
export const urgentWbSkuIds = () => urgent.getStore()?.skuIds ?? null;
const plans = new AsyncLocalStorage<Scope>();
const urgent = new AsyncLocalStorage<UrgentContext>();
export const inWbStockPlan = (clientId: string) => plans.getStore()?.clientId === clientId;
export const isUrgentWbStockSync = () => urgent.getStore() !== undefined;
export class StaleWbStockPlan extends Error {
  constructor() { super('Остатки или заказы изменились. Старый расчёт не отправлен; выполняется повторная синхронизация.'); }
}

export async function stockRevision(db: PrismaService, clientId: string): Promise<bigint> {
  const rows = await db.$queryRaw<Array<{ revision: bigint }>>`SELECT revision FROM "WbStockSyncQueue" WHERE "clientId" = ${clientId}`;
  return rows[0]?.revision ?? 0n;
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
  if (scope.revision === undefined) scope.revision = await stockRevision(db, clientId);
  else await assertFreshWbStockPlan(db, clientId);
}
export async function assertFreshWbStockPlan(db: PrismaService, clientId: string) {
  if (!urgentWbStockSyncEnabled()) return;
  const scope = plans.getStore();
  if (!scope || scope.clientId !== clientId || scope.revision === undefined) throw new StaleWbStockPlan();
  await urgent.getStore()?.guard?.();
  if (scope.revision !== await stockRevision(db, clientId)) throw new StaleWbStockPlan();
}

export const wbStockRetryDelay = (attempt: number) => Math.min(300_000, 5_000 * 2 ** Math.min(6, Math.max(0, attempt - 1)));
type Job = { clientId: string; revision: bigint; attempts: number; skuIds?: string[]; allSkus?: boolean };

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
    const rows = await this.db.$queryRaw<Job[]>`UPDATE "WbStockSyncQueue" SET "leaseToken" = ${token}, "leaseUntil" = now() + interval '60 seconds'
      WHERE "clientId" = (SELECT "clientId" FROM "WbStockSyncQueue" WHERE revision > "completedRevision" AND "nextAttemptAt" <= now()
        AND ("leaseUntil" IS NULL OR "leaseUntil" < now()) ORDER BY "nextAttemptAt", "requestedAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING "clientId", revision, attempts, "skuIds", "allSkus"`;
    const job = rows[0];
    if (!job) return;
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
      payload: { phase, revision: job.revision.toString(), ...details } as any,
    } });
    try {
      await record('STARTED');
      await urgent.run({ skuIds: job.allSkus || !job.skuIds?.length ? null : job.skuIds, guard: renew }, () => this.sync(job.clientId));
      // A change during the last HTTP request remains pending; it cannot be acknowledged away.
      const current = await stockRevision(this.db, job.clientId);
      if (current !== job.revision || leaseLost) throw new StaleWbStockPlan();
      await renew();
      await record('PROCESSED');
      await this.db.$executeRaw`UPDATE "WbStockSyncQueue" SET "completedRevision" = ${job.revision}, attempts = 0, "lastError" = NULL,
        "skuIds" = CASE WHEN revision = ${job.revision} THEN ARRAY[]::text[] ELSE "skuIds" END,
        "allSkus" = CASE WHEN revision = ${job.revision} THEN false ELSE "allSkus" END,
        "leaseToken" = NULL, "leaseUntil" = NULL WHERE "clientId" = ${job.clientId} AND "leaseToken" = ${token}`;
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

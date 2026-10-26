import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { ShopPublicationJob } from './multishop-stock-publication';

export const MULTISHOP_QUEUE_PREFIX = 'marketplace.multishop.queue.v1:';
type StoredJob = { job: ShopPublicationJob; clientId: string; token: string | null; leaseUntil: number; nextAttemptAt: number; error: string | null };
export type ShopQueueLease = { key: string; token: string; job: ShopPublicationJob; clientId: string };
const storageKey = (clientId: string, warehouseId: string, skuId: string) => MULTISHOP_QUEUE_PREFIX + JSON.stringify([clientId, warehouseId, skuId]);

// FIX: one durable row per physical pool, with transactional enqueue/claim/CAS.
// No database transaction spans a marketplace request. Unknown results resume by reading.
export class MultishopStockQueue {
  constructor(private readonly db: PrismaClient, private readonly now: () => number = Date.now) {}

  private async locked<T>(key: string, action: (tx: Prisma.TransactionClient, row: StoredJob | null) => Promise<T>) {
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const setting = await tx.systemSetting.findUnique({ where: { key } });
      return action(tx, setting ? setting.value as unknown as StoredJob : null);
    });
  }
  private async put(tx: Prisma.TransactionClient, key: string, value: StoredJob) {
    const json = value as unknown as Prisma.InputJsonValue;
    await tx.systemSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
  }

  async enqueue(clientId: string, job: ShopPublicationJob) {
    const key = storageKey(clientId, job.warehouseId, job.skuId);
    await this.locked(key, async (tx, previous) => {
      if (previous?.job.revision === job.revision && JSON.stringify(previous.job.desired) === JSON.stringify(job.desired) && previous.job.mode === job.mode) {
        if (['DONE', 'STALE'].includes(previous.job.status) && previous.leaseUntil <= this.now() && previous.nextAttemptAt <= this.now()) {
          await this.put(tx, key, { ...previous, token: null, job: { ...previous.job, status: 'VERIFY' } });
        }
        return;
      }
      // Keep the old destinations even across a removal or a second change before delivery.
      const destinations = [...new Set([...(previous?.job.destinations ?? []), ...Object.keys(previous?.job.desired ?? {}), ...job.destinations, ...Object.keys(job.desired)])];
      await this.put(tx, key, { clientId, job: { ...job, id: randomUUID(), destinations, status: 'PENDING', attempts: 0 },
        // Invalidate the holder without allowing concurrent I/O before its lease expires.
        token: null, leaseUntil: previous?.leaseUntil ?? 0, nextAttemptAt: Math.max(previous?.leaseUntil ?? 0, previous?.nextAttemptAt ?? 0), error: null });
    });
    return key;
  }

  async claim(key: string): Promise<ShopQueueLease | null> {
    return this.locked(key, async (tx, row) => {
      const now = this.now();
      if (!row || ['DONE', 'STALE'].includes(row.job.status) || row.leaseUntil > now || row.nextAttemptAt > now) return null;
      const token = randomUUID();
      await this.put(tx, key, { ...row, token, leaseUntil: now + 120_000 });
      return { key, token, job: row.job, clientId: row.clientId };
    });
  }
  async assertLease(lease: ShopQueueLease) {
    const value = (await this.db.systemSetting.findUnique({ where: { key: lease.key } }))?.value as unknown as StoredJob | undefined;
    if (!value || value.token !== lease.token || value.job.id !== lease.job.id || value.leaseUntil <= this.now()) throw new Error('Версия или блокировка отправки изменилась.');
  }
  async persist(lease: ShopQueueLease, job: ShopPublicationJob) {
    await this.locked(lease.key, async (tx, row) => {
      if (!row || row.token !== lease.token || row.job.id !== job.id || row.leaseUntil <= this.now()) throw new Error('Версия или блокировка отправки изменилась.');
      await this.put(tx, lease.key, { ...row, job });
    });
  }
  async release(lease: ShopQueueLease, failed: boolean) {
    await this.locked(lease.key, async (tx, row) => {
      if (!row || row.token !== lease.token || row.job.id !== lease.job.id) return;
      // Never store provider error bodies: they can contain credentials or customer data.
      const delay = failed ? Math.min(300_000, 30_000 * 2 ** Math.min(row.job.attempts, 3)) : 30_000;
      await this.put(tx, lease.key, { ...row, token: null, leaseUntil: 0, nextAttemptAt: this.now() + delay,
        error: failed ? 'Отправка не подтверждена. Перед повтором будет прочитан остаток маркетплейса.' : null });
    });
  }
  async list(clientId?: string) {
    const rows = await this.db.systemSetting.findMany({ where: { key: { startsWith: MULTISHOP_QUEUE_PREFIX } }, orderBy: { key: 'asc' } });
    return rows.map(row => ({ key: row.key, ...row.value as unknown as StoredJob })).filter(row => !clientId || row.clientId === clientId).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.key.localeCompare(b.key));
  }
}

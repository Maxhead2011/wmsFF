import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { WbStockProof } from './wb-stock-safe-publication';

type Context = { connectionId: string; rebalance: boolean; guard: () => Promise<void> };
const context = new AsyncLocalStorage<Context>();

export class WbStockObservations {
  constructor(private readonly db: PrismaService) {}

  // FIX: cross-process account lock; nested PUTs reuse it, timeout forbids further requests.
  async locked<T>(connectionId: string, rebalance: boolean, action: () => Promise<T>): Promise<T> {
    const current = context.getStore();
    if (current?.connectionId === connectionId) { await current.guard(); return action(); }
    return this.db.$transaction(async tx => {
      const lock = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${'wb.stock.publish.' + connectionId})) AS acquired`;
      if (!lock[0]?.acquired) throw new ConflictException('По этому кабинету WB уже выполняется отправка остатков. Дождитесь её завершения.');
      const guard = async () => { await tx.$queryRaw`SELECT 1`; };
      return context.run({ connectionId, rebalance, guard }, action);
    }, { timeout: 600_000, maxWait: 5000 });
  }
  inRebalance(connectionId: string) { return context.getStore()?.connectionId === connectionId && context.getStore()?.rebalance === true; }
  async guard() { await context.getStore()?.guard(); }

  recorder(clientId: string, connectionId: string, runId = randomUUID()) {
    const ids = new Map<string, string>();
    return async (row: WbStockProof) => {
      const key = `${row.warehouseId}:${row.chrtId}`;
      const id = ids.get(key);
      const data = { phase: row.phase, status: row.status, calculatedAmount: row.amount,
        ...(row.sentAmount === undefined ? {} : { sentAmount: row.sentAmount }),
        ...(row.status === 'SENDING' ? { sentAt: new Date() } : {}),
        ...(row.observedAmount === undefined ? {} : { observedAmount: row.observedAmount, checkedAt: new Date() }),
        ...(row.error ? { error: row.error } : {}) };
      if (id) await this.db.wbStockPublicationCheck.update({ where: { id }, data });
      else {
        const base = { ...data, clientId, connectionId, runId, warehouseId: row.warehouseId, skuId: row.skuId, chrtId: row.chrtId };
        const saved = await this.db.wbStockPublicationCheck.upsert({ where: { connectionId_warehouseId_chrtId: { connectionId, warehouseId: row.warehouseId, chrtId: row.chrtId } }, create: base, update: { ...base, sentAmount: null, observedAmount: null, sentAt: null, checkedAt: null, error: null } });
        ids.set(key, saved.id);
      }
    };
  }

  async observe(clientId: string, connectionId: string, warehouseId: string, amounts: Map<number, number>, skus: Map<number, string>, at = new Date()) {
    const msk = new Date(at.getTime() + 3 * 3600000);
    const day = msk.toISOString().slice(0, 10);
    const bit = 1 << msk.getUTCHours();
    const rows = [...amounts].filter(([chrtId]) => skus.has(chrtId));
    // One row per SKU/warehouse/day; repeated polling within an hour does not inflate exposure.
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      if (!batch.length) continue;
      await this.db.$executeRaw(Prisma.sql`INSERT INTO "WbStockAvailabilityDay" ("id", "clientId", "connectionId", "warehouseId", "skuId", "day", "observedMask", "positiveMask", "updatedAt") VALUES ${Prisma.join(batch.map(([chrtId, amount]) => Prisma.sql`(${randomUUID()}, ${clientId}, ${connectionId}, ${warehouseId}, ${skus.get(chrtId)!}, ${day}, ${bit}, ${amount > 0 ? bit : 0}, ${at})`))}
        ON CONFLICT ("connectionId", "warehouseId", "skuId", "day") DO UPDATE SET
        "observedMask" = "WbStockAvailabilityDay"."observedMask" | EXCLUDED."observedMask",
        "positiveMask" = "WbStockAvailabilityDay"."positiveMask" | EXCLUDED."positiveMask", "updatedAt" = EXCLUDED."updatedAt"`);
    }
  }
}

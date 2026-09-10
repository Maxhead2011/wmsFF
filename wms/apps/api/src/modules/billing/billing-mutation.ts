import { Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PrismaService } from '../../common/prisma/prisma.service';

type Context = { root: PrismaService; client: PrismaService; afterCommit: Array<() => void | Promise<unknown>> };
const contexts = new AsyncLocalStorage<Context>();
const clients = new WeakSet<object>();
const logger = new Logger('BillingMutation');

// FIX: all cooperating invoice/charge/payment writers use the same DB transaction lock,
// including different workers and branches. No process-local mutex or schema migration.
export async function runBillingMutation<T>(db: PrismaService, operation: (client: PrismaService) => Promise<T>): Promise<T> {
  const existing = contexts.getStore();
  if (existing && (existing.root === db || existing.client === db)) return operation(existing.client);
  const afterCommit: Context['afterCommit'] = [];
  const result = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(1464685395, 1179209294)`;
    // Existing writers contain transaction callbacks. Reuse this transaction instead of
    // opening an independently committed transaction inside the financial operation.
    const client: PrismaService = new Proxy(tx, {
      get(target, property) {
        if (property === '$transaction') return (callback: unknown) => {
          if (typeof callback === 'function') return callback(client);
          if (Array.isArray(callback)) return Promise.all(callback);
          throw new TypeError('Unsupported nested billing transaction');
        };
        return Reflect.get(target, property);
      },
    }) as PrismaService;
    clients.add(client);
    return contexts.run({ root: db, client, afterCommit }, () => operation(client));
  }, { maxWait: 10000, timeout: 60000 });
  // Notifications are deliberately outside the commit; a delivery failure cannot roll
  // back a successful payment or encourage the user to pay the same invoice twice.
  for (const callback of afterCommit) await deliver(callback);
  return result;
}

export function isBillingMutationClient(db: object): boolean { return clients.has(db); }

// FIX: another draft is a fixed snapshot, not permission for this automation to recalculate it.
export function isOwnedUnpaidDraft(invoice: {
  sourceKey: string | null; status: string; paidRub: unknown; _count: { payments: number };
}, sourceKey: string): boolean {
  return invoice.sourceKey === sourceKey && invoice.status === 'DRAFT' &&
    Number(invoice.paidRub) === 0 && invoice._count?.payments === 0;
}

// FIX: isolate transaction DB on a per-call receiver; never mutate the injected singleton.
export function withBillingDb<T extends object>(service: T, client: PrismaService): T {
  return Object.create(service, { prisma: { value: client, writable: false, configurable: false } }) as T;
}

export function afterBillingCommit(callback: () => void | Promise<unknown>): void {
  const context = contexts.getStore();
  if (context) context.afterCommit.push(callback);
  else void deliver(callback);
}
async function deliver(callback: () => void | Promise<unknown>) {
  try { await callback(); }
  catch { logger.warn('Financial operation committed; notification delivery failed.'); }
}

import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

// FIX: enqueue inside the shipment transaction; a process restart cannot lose billing.
export async function enqueueFbsPrintBilling(db: Prisma.TransactionClient, clientId: string) {
  await db.fbsPrintBillingOutbox.upsert({
    where: { clientId }, create: { clientId },
    update: { revision: { increment: 1 } },
  });
}

// FIX: coalesce a client's prints, retaining a revision that arrives during billing.
// Billing keeps its existing DB lock and idempotency keys. A lease recovers crashes;
// a unique token prevents an expired worker from acknowledging its replacement's work.
export class FbsPrintBillingWorker {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private running?: Promise<void>;

  constructor(
    private readonly db: PrismaClient,
    private readonly bill: (clientId: string) => Promise<unknown>,
    private readonly reportError: (message: string) => void,
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.running = this.processNext().catch(() => {
        this.reportError('FBS print billing queue unavailable; will retry.');
      }).finally(() => {
        this.running = undefined;
        this.schedule();
      });
    }, 1000);
    this.timer.unref();
  }

  async processNext() {
    const now = new Date();
    const available = { nextAttemptAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] };
    const job = await this.db.fbsPrintBillingOutbox.findFirst({
      where: available, orderBy: [{ nextAttemptAt: 'asc' }, { clientId: 'asc' }],
    });
    if (!job) return;
    const leaseToken = randomUUID();
    const claimed = await this.db.fbsPrintBillingOutbox.updateMany({
      where: { clientId: job.clientId, revision: job.revision, ...available },
      data: { leaseToken, leaseUntil: new Date(now.getTime() + 5 * 60_000) },
    });
    if (!claimed.count) return;
    try {
      await this.bill(job.clientId);
      await this.db.fbsPrintBillingOutbox.deleteMany({
        where: { clientId: job.clientId, revision: job.revision, leaseToken },
      });
      // A newer print may have been committed after billing read its snapshots.
      await this.db.fbsPrintBillingOutbox.updateMany({
        where: { clientId: job.clientId, leaseToken },
        data: { leaseToken: null, leaseUntil: null, attempts: 0, lastError: null, nextAttemptAt: new Date() },
      });
    } catch (error) {
      await this.db.fbsPrintBillingOutbox.updateMany({
        where: { clientId: job.clientId, leaseToken },
        data: {
          leaseToken: null, leaseUntil: null, attempts: { increment: 1 },
          nextAttemptAt: new Date(Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(job.attempts, 6))),
          lastError: (error instanceof Error ? error.message : 'Billing failed').slice(0, 1000),
        },
      });
      this.reportError(`FBS print billing pending for client ${job.clientId}; will retry.`);
    }
  }
}

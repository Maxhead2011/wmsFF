import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { enqueueFbsPrintBilling, FbsPrintBillingWorker } from '../src/modules/marketplace-connections/fbs-print-billing-outbox';

const url = process.env.WB_LIFECYCLE_TEST_DATABASE_URL;
if (url && url !== 'postgresql://codex_tests@127.0.0.1:55469/wb_lifecycle_tests') throw Error('Dedicated local database required');

// TEST: use real PostgreSQL transactions and competing workers, not mocked queue semantics.
describe.skipIf(!url).sequential('durable print billing outbox', () => {
  const db = new PrismaClient(url ? { datasources: { db: { url } } } : {});
  const clients: string[] = [];
  const client = () => { const id = `print-test-${randomUUID()}`; clients.push(id); return id; };
  const read = (clientId: string) => db.fbsPrintBillingOutbox.findUnique({ where: { clientId } });
  // Scope worker reads to this test's client; mutations use the actual shared PostgreSQL table.
  const worker = (clientId: string, bill: (id: string) => Promise<unknown>, report = vi.fn()) => {
    const scoped = Object.create(db);
    Object.defineProperty(scoped, 'fbsPrintBillingOutbox', { value: new Proxy(db.fbsPrintBillingOutbox, {
      get(target, key) {
        if (key === 'findFirst') return (args: any) => target.findFirst({ ...args, where: { ...args.where, clientId } });
        return Reflect.get(target, key);
      },
    }) });
    return new FbsPrintBillingWorker(scoped, bill, report);
  };
  // TEST: readiness is explicit; PostgreSQL timestamp rounding must not delay a one-shot test worker.
  const enqueue = (id: string) => db.$transaction(async tx => {
    await enqueueFbsPrintBilling(tx, id);
    await tx.fbsPrintBillingOutbox.update({ where: { clientId: id }, data: { nextAttemptAt: new Date(0) } });
  });
  afterAll(async () => {
    await db.fbsPrintBillingOutbox.deleteMany({ where: { clientId: { in: clients } } });
    await db.$disconnect();
  });

  it('rolls back billing intent with its shipment transaction', async () => {
    const id = client();
    await expect(db.$transaction(async tx => { await enqueueFbsPrintBilling(tx, id); throw Error('shipment rollback'); })).rejects.toThrow();
    expect(await read(id)).toBeNull();
  });
  it('survives restart, coalesces prints, and completes once', async () => {
    const id = client();
    await enqueue(id); await enqueue(id);
    expect(await read(id)).toMatchObject({ revision: 2 });
    const bill = vi.fn(async () => undefined);
    await worker(id, bill).processNext();
    await worker(id, bill).processNext();
    expect(bill).toHaveBeenCalledOnce();
    expect(bill).toHaveBeenCalledWith(id);
    expect(await read(id)).toBeNull();
  });
  it('does not lose a print enqueued while billing is running', async () => {
    const id = client(); await enqueue(id);
    await worker(id, async () => { await enqueue(id); }).processNext();
    expect(await read(id)).toMatchObject({ revision: 2, leaseToken: null, attempts: 0 });
    const bill = vi.fn(async () => undefined);
    await worker(id, bill).processNext();
    expect(bill).toHaveBeenCalledOnce();
    expect(await read(id)).toBeNull();
  });
  it('retries failed billing after backoff with the durable record intact', async () => {
    const id = client(); await enqueue(id);
    const report = vi.fn();
    const failing = vi.fn(async () => { throw Error('billing temporarily unavailable'); });
    await worker(id, failing, report).processNext();
    expect(await read(id)).toMatchObject({ attempts: 1, leaseToken: null, lastError: 'billing temporarily unavailable' });
    expect(report).toHaveBeenCalledOnce();
    await worker(id, failing).processNext();
    expect(failing).toHaveBeenCalledOnce();
    await db.fbsPrintBillingOutbox.update({ where: { clientId: id }, data: { nextAttemptAt: new Date(0) } });
    await worker(id, async () => undefined).processNext();
    expect(await read(id)).toBeNull();
  });
  it('allows only one worker to claim a pending client', async () => {
    const id = client(); await enqueue(id);
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const bill = vi.fn(async () => { started(); await hold; });
    const first = worker(id, bill).processNext();
    await entered;
    try { await worker(id, bill).processNext(); expect(bill).toHaveBeenCalledOnce(); }
    finally { release(); await first; }
    expect(await read(id)).toBeNull();
  });
  it('recovers an expired lease after a crash', async () => {
    const id = client(); await enqueue(id);
    await db.fbsPrintBillingOutbox.update({ where: { clientId: id }, data: { leaseToken: 'dead-process', leaseUntil: new Date(0) } });
    const bill = vi.fn(async () => undefined);
    await worker(id, bill).processNext();
    expect(bill).toHaveBeenCalledOnce();
    expect(await read(id)).toBeNull();
  });
  it('prevents an expired worker deleting work claimed by its replacement', async () => {
    const id = client(); await enqueue(id);
    await worker(id, async () => {
      // Simulate replacement after expiry, still working on the same revision.
      await db.fbsPrintBillingOutbox.update({ where: { clientId: id }, data: { leaseToken: 'replacement' } });
    }).processNext();
    expect(await read(id)).toMatchObject({ revision: 1, leaseToken: 'replacement' });
  });
});

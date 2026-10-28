import { describe, expect, it } from 'vitest';
import { MultishopStockQueue } from '../src/modules/marketplace-connections/multishop-stock-queue';
import { ShopPublicationJob } from '../src/modules/marketplace-connections/multishop-stock-publication';

function fixture() {
  let time = 1_000, tail = Promise.resolve();
  const rows = new Map<string, any>();
  const db: any = { $executeRaw: async () => 1, systemSetting: {
    findUnique: async ({ where }: any) => rows.get(where.key) ?? null,
    upsert: async ({ where, create, update }: any) => { rows.set(where.key, structuredClone(rows.has(where.key) ? { key: where.key, ...update } : create)); },
    findMany: async () => [...rows.values()],
  } };
  db.$transaction = async (fn: any) => { const before = tail; let release!: () => void; tail = new Promise<void>(r => { release = r; }); await before; try { return await fn(db); } finally { release(); } };
  return { queue: new MultishopStockQueue(db, () => time), restart: () => new MultishopStockQueue(db, () => time), advance: () => { time += 121_000; } };
}
const job: ShopPublicationJob = { id: 'input', revision: 'v1', skuId: 'sku', warehouseId: 'msk', destinations: ['a'], desired: { a: 10 }, mode: 'SHARED', status: 'PENDING', attempts: 0 };
describe('durable shared stock queue', () => {
  // TEST: different worker instances cannot claim the same persisted pool simultaneously.
  it('allows only one claim and survives a worker restart', async () => {
    const f = fixture(); const key = await f.queue.enqueue('client', job);
    const leases = await Promise.all([f.queue.claim(key), f.restart().claim(key)]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    f.advance();
    const resumed = await f.restart().claim(key);
    expect(resumed?.job.destinations).toEqual(['a']);
    await expect(f.queue.assertLease(leases.find(Boolean)!)).rejects.toThrow('блокировка');
  });
  it('retains removed destinations and fences an in-flight old version', async () => {
    const f = fixture(); const key = await f.queue.enqueue('client', job); const lease = (await f.queue.claim(key))!;
    await f.queue.enqueue('client', { ...job, revision: 'v2', destinations: ['b'], desired: { b: 10 } });
    await expect(f.queue.persist(lease, { ...lease.job, status: 'DONE' })).rejects.toThrow();
    expect(await f.queue.claim(key)).toBeNull();
    f.advance();
    expect((await f.queue.claim(key))?.job.destinations).toEqual(['a', 'b']);
  });
  it('keeps unknown write intent for read-back after retry', async () => {
    const f = fixture(); const key = await f.queue.enqueue('client', job); const lease = (await f.queue.claim(key))!;
    await f.queue.persist(lease, { ...lease.job, status: 'INCREASE', attempts: 1 });
    await f.queue.release(lease, true);
    expect(await f.queue.claim(key)).toBeNull();
    f.advance();
    expect((await f.restart().claim(key))?.job.status).toBe('INCREASE');
  });
  it('does not requeue the same completed plan or mix clients', async () => {
    const f = fixture(); const key = await f.queue.enqueue('client', job); const lease = (await f.queue.claim(key))!;
    await f.queue.persist(lease, { ...lease.job, status: 'DONE' }); await f.queue.release(lease, false);
    await f.queue.enqueue('client', job); f.advance();
    expect(await f.queue.claim(key)).toBeNull();
    expect(await f.queue.list('other')).toEqual([]);
  });
});

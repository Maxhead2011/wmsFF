import { planShopTransition } from './multishop-stock-plan';

export type ShopPublicationJob = {
  id: string; revision: string; skuId: string; warehouseId: string;
  destinations: string[]; desired: Record<string, number>;
  status: 'PENDING' | 'VERIFY' | 'DECREASE' | 'INCREASE' | 'DONE' | 'STALE';
  attempts: number;
};
export type ShopPublicationPorts = {
  // The caller holds a per-physical-SKU durable lease and excludes legacy writers.
  assertLease: () => Promise<void>;
  current: () => Promise<{ revision: string; budget: number }>;
  observe: (destinations: string[]) => Promise<Record<string, number | null>>;
  persist: (job: ShopPublicationJob) => Promise<void>;
  write: (destination: string, amount: number) => Promise<void>;
};

// FIX: record intent before I/O; a crash or timeout always resumes with an observation.
// No transport retries happen here: the next durable run verifies actual stock first.
export async function advanceShopPublication(job: ShopPublicationJob, ports: ShopPublicationPorts) {
  await ports.assertLease();
  const current = await ports.current();
  if (current.revision !== job.revision) {
    const next = { ...job, status: 'STALE' as const };
    await ports.persist(next); return next;
  }
  if (job.status === 'STALE') throw new Error('Создайте новый план распределения.');
  const required = [...new Set([...job.destinations, ...Object.keys(job.desired)])];
  const observed = await ports.observe(required);
  // Missing observations are unknown, never an implicit zero for an old cabinet.
  const complete = Object.fromEntries(required.map(id => [id, observed[id] ?? null]));
  const transition = planShopTransition(current.budget, complete, job.desired);
  const next = { ...job, destinations: required, status: transition.phase, attempts: job.attempts + 1 };
  await ports.persist(next);
  for (const item of transition.writes) {
    await ports.assertLease();
    const fresh = await ports.current();
    if (fresh.revision !== job.revision || fresh.budget !== current.budget) {
      const stale = { ...next, status: 'STALE' as const };
      await ports.persist(stale); return stale;
    }
    // Never mark ACK as success; even a successful write needs a later read-back.
    await ports.write(item.destination, item.amount);
  }
  return next;
}

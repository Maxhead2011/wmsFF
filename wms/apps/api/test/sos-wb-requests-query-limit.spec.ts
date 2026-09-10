import { expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: exercise the public service entry with a strict prepared-statement limit.
function fixture(count = 1) {
  const tasks = Array.from({ length: count }, (_, n) => ({ requestId: `r${n}`, connectionId: 'c1', orderId: `o${n}` }));
  const links = tasks.map(t => ({ ...t, syncStatus: 'ACTIVE', lastCategory: 'active' }));
  const rows = new Map(tasks.map((t, n) => [t.requestId, { id: t.requestId, number: n, title: `Request ${n}`,
    status: 'IN_WORK', warehouseId: 'moscow', createdAt: new Date(n * 1000), client: { id: 'client', code: 'CL', name: 'Client' } }]));
  const bounded = (ids: string[], extra: number) => {
    if (ids.length + extra > 32767) throw new Error('too many bind variables in prepared statement');
  };
  const db = {
    fbsTsdAssembly: { findMany: vi.fn(async (_query: any) => tasks) },
    fbsOrderRequestLink: { findMany: vi.fn(async (query: any) => {
      bounded(query.where.requestId.in, 4);
      const ids = new Set(query.where.requestId.in);
      return links.filter(t => ids.has(t.requestId) && t.syncStatus === query.where.syncStatus && query.where.lastCategory.in.includes(t.lastCategory));
    }) },
    clientRequest: { findMany: vi.fn(async (query: any) => {
      bounded(query.where.id.in, 4);
      return query.where.id.in.map((id: string) => rows.get(id)).filter((r: any) => r &&
        !query.where.status.notIn.includes(r.status) && (!query.where.warehouseId || r.warehouseId === query.where.warehouseId))
        .sort((a: any, b: any) => b.number - a.number || b.createdAt.getTime() - a.createdAt.getTime());
    }) },
  };
  const service = Object.create(MarketplaceConnectionsService.prototype) as any;
  const clientFilter = { in: ['client'] };
  const scope = vi.fn(() => clientFilter);
  service.prisma = db;
  service.clientScopes = { resolveClientFilter: scope };
  const user: any = { id: 'worker', activeWarehouseId: 'moscow' };
  return { tasks, links, rows, db, user, scope, clientFilter, run: () => service.listSosWbRequests(user) };
}

it.each([1000, 1001, 32768])('returns all %i requests without exceeding the query limit', async count => {
  const f = fixture(count);
  const result = await f.run();
  expect(result.requests).toHaveLength(count);
  expect(new Set(result.requests.map((r: any) => r.requestId)).size).toBe(count);
  expect(result.requests[0].requestNumber).toBe(count - 1);
  expect(result.requests.at(-1).requestNumber).toBe(0);
  expect(f.db.fbsOrderRequestLink.findMany).toHaveBeenCalledTimes(Math.ceil(count / 1000));
  expect(f.db.clientRequest.findMany).toHaveBeenCalledTimes(Math.ceil(count / 1000));
  for (const [q] of f.db.fbsOrderRequestLink.findMany.mock.calls) expect(q.where.requestId.in.length).toBeLessThanOrEqual(1000);
  for (const [q] of f.db.clientRequest.findMany.mock.calls) expect(q.where.id.in.length).toBeLessThanOrEqual(1000);
});
it('returns empty without querying links or requests when no tasks exist', async () => {
  const f = fixture(0); expect(await f.run()).toEqual({ requests: [] });
  expect(f.db.fbsOrderRequestLink.findMany).not.toHaveBeenCalled(); expect(f.db.clientRequest.findMany).not.toHaveBeenCalled();
});
it('keeps active/shipped links, excludes cancelled, removed, orphan and mismatched connection/order links', async () => {
  const f = fixture(6);
  f.links[1].lastCategory = 'shipped'; f.links[2].lastCategory = 'cancelled'; f.links[3].syncStatus = 'REMOVED';
  f.links[4].connectionId = 'other'; f.links[5].orderId = 'other';
  const r = await f.run(); expect(r.requests.map((r: any) => r.requestId)).toEqual(['r1', 'r0']);
  f.links.length = 0; expect(await f.run()).toEqual({ requests: [] });
});
it('preserves task eligibility, client scope, warehouse scope and closed-request exclusion', async () => {
  const f = fixture(3); f.rows.get('r1')!.warehouseId = 'noginsk'; f.rows.get('r2')!.status = 'DONE';
  const r = await f.run(); expect(r.requests.map((r: any) => r.requestId)).toEqual(['r0']);
  expect(f.scope).toHaveBeenCalledWith(f.user);
  expect(f.db.fbsTsdAssembly.findMany.mock.calls[0][0]).toMatchObject({ where: {
    clientId: f.clientFilter, marketplace: 'WILDBERRIES', requiresKiz: true, relabelRequired: false,
    status: { in: ['RESERVED', 'WAITING_STOCK', 'RELEASED'] },
  } });
  expect(f.db.clientRequest.findMany.mock.calls[0][0].where.warehouseId).toBe('moscow');
});
it('does not invent a warehouse restriction if none was selected', async () => {
  const f = fixture(2); f.user.activeWarehouseId = undefined; f.rows.get('r1')!.warehouseId = 'noginsk';
  expect((await f.run()).requests).toHaveLength(2);
  expect(f.db.clientRequest.findMany.mock.calls[0][0].where).not.toHaveProperty('warehouseId');
});
it('deduplicates request IDs but counts all eligible orders exactly once', async () => {
  const f = fixture(); f.tasks.push({ ...f.tasks[0], orderId: 'second' });
  f.links.push({ ...f.links[0], orderId: 'second' }); f.links.push({ ...f.links[0] });
  const r = await f.run(); expect(r.requests).toHaveLength(1); expect(r.requests[0].availableOrders).toBe(2);
});
it('keeps createdAt tie-break order between batches without exposing the helper field', async () => {
  const f = fixture(1001); for (const r of f.rows.values()) r.number = 7;
  const r = await f.run(); expect(r.requests[0].requestId).toBe('r1000');
  expect(r.requests.at(-1).requestId).toBe('r0'); expect(r.requests[0]).not.toHaveProperty('createdAt');
});
it.each(['links', 'requests'])('does not return a partial success if the second %s batch fails', async target => {
  const f = fixture(1001);
  const query = target === 'links' ? f.db.fbsOrderRequestLink.findMany : f.db.clientRequest.findMany;
  const original = query.getMockImplementation()!;
  let n = 0; query.mockImplementation(async (q: any) => { if (++n === 2) throw new Error('database unavailable'); return original(q); });
  await expect(f.run()).rejects.toThrow('database unavailable');
});

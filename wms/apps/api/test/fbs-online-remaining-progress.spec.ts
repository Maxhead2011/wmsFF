import { describe, expect, it, vi } from 'vitest';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { ClientRequestsService } from '../src/modules/client-requests/client-requests.service';
import { TsdAssemblyService } from '../src/modules/tsd/tsd-assembly.service';

// TEST: online progress must preserve physical completions predating local-search activation.
function fixture(enabled = true, completed = 12, reset = false) {
  const request = { id: 'request-592', status: 'IN_WORK', _count: { fbsOrderLinks: 13 },
    fbsEmergencyAssemblyAt: enabled ? new Date('2026-09-04T17:12:36Z') : null };
  const tasks = Array.from({ length: 13 }, (_, n) => ({
    id: `task-${n}`, requestId: request.id, requestItemId: `item-${n}`, skuId: `sku-${n}`,
    orderId: `order-${n}`, status: reset ? 'WAITING_STOCK' : n < completed ? 'COMPLETED' : 'RESERVED',
    completedAt: n < completed ? new Date('2026-09-03T15:00:00Z') : null,
    updatedAt: new Date('2026-09-03T15:00:00Z'), deviceCode: 'TSD-1', itemCount: 1,
    kiz: n < completed ? `saved-mark-${n}` : null, barcode: `barcode-${n}`, boxCode: `box-${n}`,
    productName: 'Костюм', requiresKiz: true, cargoPackingId: null, cargoPacking: null,
  }));
  const links = tasks.map(t => ({ requestId: request.id, clientId: 'client-1',
    orderId: t.orderId, connectionId: 'wb-1', marketplace: 'WILDBERRIES', lastSkuId: t.skuId }));
  const rows = tasks.map(t => ({ itemId: t.requestItemId, skuId: t.skuId,
    name: 'Костюм', barcode: t.barcode, requestedQuantity: 1, allocations: [] }));
  const db = {
    clientRequest: { findMany: vi.fn(async () => [request]), findUnique: vi.fn(async () => request) },
    fbsOrderRequestLink: { findMany: vi.fn(async () => links) },
    fbsTsdAssembly: { findMany: vi.fn(async () => tasks) },
    sku: { findMany: vi.fn(async () => []) }, auditLog: { findMany: vi.fn(async () => []) },
  };
  const user = { id: 'reader', roleCodes: ['CLIENT'], permissionCodes: [],
    clientScopeMode: 'LIMITED', clientIds: ['client-1'], writableClientIds: [] } as any;
  const list = new ClientRequestsService(db as never, new ClientScopeService(), {} as never);
  const detail = new TsdAssemblyService(db as never, {} as never, {} as never, {} as never) as any;
  return { db, tasks, rows, user, list, detail };
}

describe('FBS online remaining-search progress', () => {
  it.each([true, false])('list keeps 12/13 completions (local mode: %s)', async enabled => {
    const f = fixture(enabled);
    const result = await f.list.list({}, f.user);
    expect(result[0]).toMatchObject({ fbsCompletion: {
      totalOrders: 13, completedOrders: 12, percent: 92, completed: false,
    } });
  });

  it.each([true, false])('details keep saved scans and only one uncollected item (local mode: %s)', async enabled => {
    const f = fixture(enabled); const before = structuredClone(f.tasks);
    const result = await f.detail.loadFbsAssemblyFacts('request-592', f.rows);
    expect(result).toMatchObject({ totalOrders: 13, completedOrders: 12,
      notCollected: { remainingOrders: 1, remainingUnits: 1, remainingPositions: 1, pendingOrderIds: ['order-12'] } });
    expect(result.rows.filter(r => r.status === 'COMPLETED')).toHaveLength(12);
    expect(result.rows[0]).toMatchObject({ kiz: 'saved-mark-0', sourceBoxCode: 'box-0' });
    expect(f.tasks).toEqual(before);
  });

  it('fully completed local request shows 100% with no items left to collect', async () => {
    const f = fixture(true, 13);
    expect((await f.list.list({}, f.user))[0]).toMatchObject({ fbsCompletion: { completedOrders: 13, percent: 100, completed: true } });
    expect(await f.detail.loadFbsAssemblyFacts('request-592', f.rows)).toMatchObject({
      completedOrders: 13, notCollected: { remainingOrders: 0, remainingUnits: 0, rows: [] },
    });
  });

  it('full emergency reset still requires every task, even with historical completion dates', async () => {
    const f = fixture(true, 12, true);
    expect((await f.list.list({}, f.user))[0]).toMatchObject({ fbsCompletion: { completedOrders: 0, percent: 0, completed: false } });
    expect(await f.detail.loadFbsAssemblyFacts('request-592', f.rows)).toMatchObject({
      completedOrders: 0, notCollected: { remainingOrders: 13, remainingUnits: 13 },
    });
  });

  it('explicit COMPLETED status counts even when legacy completion timestamp is absent', async () => {
    const f = fixture(); f.tasks[0].completedAt = null;
    expect((await f.list.list({}, f.user))[0]).toMatchObject({ fbsCompletion: { completedOrders: 12 } });
    expect(await f.detail.loadFbsAssemblyFacts('request-592', f.rows)).toMatchObject({ completedOrders: 12 });
  });

  // TEST: marketplace cancellation is a manager decision, not a reason to collect all items again.
  it('keeps return-required and in-progress work separate from completed and uncollected goods', async () => {
    const f = fixture();
    f.tasks[0].status = 'RETURN_REQUIRED'; f.tasks[12].status = 'IN_PROGRESS';
    const links = await f.db.fbsOrderRequestLink.findMany();
    f.db.fbsOrderRequestLink.findMany.mockResolvedValue(links.filter(link => link.orderId !== 'order-0'));
    expect((await f.list.list({}, f.user))[0]).toMatchObject({ fbsCompletion: { totalOrders: 12, completedOrders: 11, completed: false } });
    expect(await f.detail.loadFbsAssemblyFacts('request-592', f.rows)).toMatchObject({
      completedOrders: 11, returnRequired: { orders: 1, units: 1 },
      notCollected: { remainingOrders: 1, remainingUnits: 1, pendingOrderIds: ['order-12'] },
    });
  });
});

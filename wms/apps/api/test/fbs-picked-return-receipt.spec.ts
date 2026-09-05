import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { BoxCodePolicyService } from '../src/common/boxes/box-code-policy.service';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const kiz = '0104680992593139215a%9RNyiE_KVd\u001d91EE12\u001d92CRYPTO';
const user: any = { id: 'worker', name: 'Worker', activeWarehouseId: 'wh', warehouseIds: ['wh'],
  writableWarehouseIds: ['wh'], roleCodes: ['WAREHOUSE'], permissionCodes: ['client-requests:write'] };

// TEST: exercise the public conflict-resolution workflow with transaction rollback and stock state.
function fixture() {
  vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'true');
  const task: any = { id: 'task', requestId: 'request', requestItemId: 'item', clientId: 'client',
    marketplace: 'WILDBERRIES', connectionId: 'connection', orderId: '5426435634', skuId: 'sku',
    status: 'RETURN_REQUIRED', boxId: 'source', boxCode: 'FFL_OLD', barcode: '0012345678901',
    itemCount: 1, requiresKiz: true, kiz, wbMetaStatus: 'ACCEPTED', productName: 'Suit',
    completedAt: new Date('2026-09-06T10:00:00Z'), updatedAt: new Date('2026-09-06T10:30:00Z') };
  const link: any = { id: 'link', requestId: 'request', syncStatus: 'RETURN_REQUIRED', lastCategory: 'cancelled' };
  const mark: any = { id: 'mark', clientId: 'client', skuId: 'sku', value: kiz, status: 'PACKING',
    boxId: null, updatedAt: new Date('2026-09-06T09:59:00Z') };
  const target: any = { id: 'target', code: 'FFL_LKBBOX_014', clientId: 'client', warehouseId: 'wh', status: 'active', palletId: 'pallet' };
  const request: any = { id: 'request', clientId: 'client', warehouseId: 'wh', status: 'IN_WORK' };
  let packing = 1; let available = 0;
  const movements: any[] = [];
  const tx: any = {
    fbsTsdAssembly: { findUnique: vi.fn(async () => ({ ...task })), update: vi.fn(async ({ data }: any) => Object.assign(task, data)) },
    fbsOrderRequestLink: { findUnique: vi.fn(async () => ({ ...link })), update: vi.fn(async ({ data }: any) => Object.assign(link, data)) },
    clientRequest: { findUnique: vi.fn(async () => request) },
    box: { findUnique: vi.fn(async () => target) },
    sku: { findUnique: vi.fn(async () => ({ id: 'sku', clientId: 'client', barcodes: [{ value: '0012345678901' }] })) },
    inventoryAuditBox: { findFirst: vi.fn(async () => null) },
    stockMovement: { findMany: vi.fn(async () => [{ warehouseId: 'wh', boxId: 'source', palletId: null, quantity: 1 }]),
      create: vi.fn(async ({ data }: any) => { const row = { id: `move-${movements.length}`, ...data }; movements.push(row); return row; }) },
    stockBalance: { findMany: vi.fn(async () => packing ? [{ id: 'packing', quantity: packing, warehouseId: 'wh', boxId: 'source', palletId: null, status: 'PACKING' }] : []),
      delete: vi.fn(async () => { packing = 0; }), update: vi.fn(),
      upsert: vi.fn(async ({ create }: any) => { available += create.quantity; return create; }) },
    productMark: { findFirst: vi.fn(async () => ({ ...mark })), updateMany: vi.fn(async ({ data }: any) => { Object.assign(mark, data); return { count: 1 }; }) },
    clientRequestBoxSelection: { findUnique: vi.fn(async () => ({ id: 'selection', quantity: 1 })), delete: vi.fn(), update: vi.fn() },
    fbsCargoPlacePacking: { updateMany: vi.fn() }, clientRequestEvent: { create: vi.fn() }, auditLog: { create: vi.fn() },
  };
  const db = { ...tx, $transaction: async (fn: any) => {
    const before = structuredClone({ task, link, mark, packing, available, movements });
    try { return await fn(tx); } catch (error) {
      for (const [object, snapshot] of [[task, before.task], [link, before.link], [mark, before.mark]]) {
        for (const key of Object.keys(object)) delete object[key]; Object.assign(object, snapshot);
      }
      packing = before.packing; available = before.available; movements.splice(0, movements.length, ...before.movements); throw error;
    }
  } };
  const service = new MarketplaceConnectionsService(db as never, { requireClientAccess: vi.fn() } as never,
    { assertStockMovementsAllowed: vi.fn() } as never, undefined,
    new BoxCodePolicyService({ get: async () => ({ storageBoxAliases: ['FFL_LKBBOX'] }) } as never));
  vi.spyOn(service, 'listFbsOrders').mockResolvedValue({} as never);
  const dto: any = { action: 'RETURN_TO_STOCK', returnBoxCode: 'FFL_LKBBOX_014', returnBarcode: '0012345678901', returnKiz: kiz };
  return { task, link, mark, target, request, tx, service, dto, movements, quantities: () => [packing, available],
    apply: (body = dto, actor = user) => service.resolveFbsSyncConflict('request', 'task', body, actor) };
}

describe('physically picked cancellation requires re-receipt', () => {
  it.each(['RETURN_TO_STOCK', 'MANAGER_CONFIRMED'])('cannot restore stock through %s without receipt scans', async action => {
    const f = fixture();
    await expect(f.apply({ action, comment: 'approved' })).rejects.toThrow(/при[её]м|скан/i);
    expect(f.quantities()).toEqual([1, 0]); expect(f.task.status).toBe('RETURN_REQUIRED');
    expect(f.tx.stockMovement.create).not.toHaveBeenCalled();
  });
  it('receives exactly one unit and its existing KIZ into the scanned box, not the old box', async () => {
    const f = fixture(); await f.apply();
    expect(f.quantities()).toEqual([0, 1]);
    expect(f.tx.stockBalance.upsert.mock.calls[0][0].create).toMatchObject({ boxId: 'target', status: 'AVAILABLE', quantity: 1 });
    expect(f.mark).toMatchObject({ id: 'mark', boxId: 'target', status: 'AVAILABLE' });
    expect(f.movements.map(row => row.quantity)).toEqual([-1, 1]);
    expect(f.movements[1]).toMatchObject({ boxId: 'target', type: 'RETURN' });
    await expect(f.apply()).rejects.toThrow();
    expect(f.quantities()).toEqual([0, 1]); expect(f.movements).toHaveLength(2);
  });
  it('does not copy an old pallet to an unpalleted destination', async () => {
    const f = fixture(); f.target.palletId = null;
    f.tx.stockMovement.findMany.mockResolvedValue([{ warehouseId: 'wh', boxId: 'source', palletId: 'old-pallet', quantity: 1 }]);
    await f.apply();
    expect(f.tx.stockBalance.upsert.mock.calls[0][0].create).toMatchObject({ boxId: 'target', palletId: null });
  });
  // TEST: a previous return from SHIPPING must not remain as a phantom pick on reassembly.
  it('counts a returned SHIPPING reservation before a new pick', async () => {
    const f = fixture(); f.task.completedAt = null;
    f.tx.stockMovement.findMany.mockImplementation(async ({ where }: any) =>
      where.OR ? [{ quantity: 1 }, { quantity: -1 }] : [{ quantity: 1 }]);
    f.tx.stockBalance.findMany.mockResolvedValue([]);
    await (f.service as any).reserveCompletedWildberriesStock(f.tx, f.task, 'wh');
    expect(f.tx.stockBalance.findMany).toHaveBeenCalled();
    expect(f.tx.stockBalance.upsert.mock.calls[0][0].create).toMatchObject({ status: 'PACKING', quantity: 1 });
    expect(f.movements[0].idempotencyKey).toContain('attempt-2');
  });
  it('uses the current source box when the same task has a completed previous return', async () => {
    const f = fixture();
    f.tx.stockMovement.findMany.mockImplementation(async ({ where }: any) => {
      const current = { warehouseId: 'wh', boxId: 'source', palletId: null, quantity: 1 };
      return where.boxId === 'source' ? [current] : [
        { ...current, boxId: 'earlier-box', quantity: 1 },
        { ...current, boxId: 'earlier-box', quantity: -1 }, current,
      ];
    });
    f.tx.stockBalance.findMany.mockImplementation(async ({ where }: any) => where.boxId === 'source'
      ? [{ id: 'packing', quantity: 1, warehouseId: 'wh', boxId: 'source', palletId: null, status: 'PACKING' }] : []);
    await f.apply();
    expect(f.quantities()).toEqual([0, 1]);
    expect(f.movements[0].boxId).toBe('source');
    expect(f.movements[1].idempotencyKey).toBe('fbs-sticker-pick:task:return-2:in');
  });
  it('requires receipt even if the KIZ was accepted before sticker confirmation', async () => {
    const f = fixture(); f.task.completedAt = null;
    await expect(f.apply({ action: 'RETURN_TO_STOCK' })).rejects.toThrow();
    await f.apply();
    expect(f.quantities()).toEqual([0, 1]);
  });
  it('rejects invalid receipt access before deleting metadata from a still-active WB order', async () => {
    const f = fixture(); f.link.lastCategory = 'assembly'; f.target.clientId = 'other';
    const remote = vi.fn(); vi.stubGlobal('fetch', remote);
    await expect(f.apply()).rejects.toThrow(); expect(remote).not.toHaveBeenCalled();
    expect(f.quantities()).toEqual([1, 0]);
  });
  it('rolls back when the KIZ changed concurrently with receipt', async () => {
    const f = fixture(); f.tx.productMark.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.apply()).rejects.toThrow('КИЗ изменился');
    expect(f.quantities()).toEqual([1, 0]); expect(f.movements).toHaveLength(0);
  });
  it('does not restore a multi-unit or post-shipment return without proven unit accounting', async () => {
    const f = fixture(); f.task.itemCount = 2;
    await expect(f.apply()).rejects.toThrow('поштучная');
    expect(f.quantities()).toEqual([1, 0]);
  });
  it.each(['barcode', 'KIZ', 'client', 'warehouse', 'archived box', 'counting box', 'shipped request', 'moved mark', 'wrong mark sku', 'missing packing', 'client user'])('rejects %s without stock changes', async fault => {
    const f = fixture();
    if (fault === 'barcode') f.dto.returnBarcode = 'wrong';
    if (fault === 'KIZ') f.dto.returnKiz = kiz.toUpperCase();
    if (fault === 'client') f.target.clientId = 'other';
    if (fault === 'warehouse') f.target.warehouseId = 'other';
    if (fault === 'archived box') f.target.status = 'archived';
    if (fault === 'counting box') f.tx.inventoryAuditBox.findFirst.mockResolvedValue({ id: 'counting' });
    if (fault === 'shipped request') f.request.status = 'DONE';
    if (fault === 'moved mark') { f.mark.boxId = 'other'; f.mark.status = 'AVAILABLE'; }
    if (fault === 'wrong mark sku') f.mark.skuId = 'other';
    if (fault === 'missing packing') f.tx.stockMovement.findMany.mockResolvedValue([]);
    await expect(f.apply(f.dto, fault === 'client user' ? { ...user, roleCodes: ['CLIENT'] } : user)).rejects.toThrow();
    expect(f.quantities()).toEqual([1, 0]); expect(f.task.status).toBe('RETURN_REQUIRED');
    expect(f.movements).toHaveLength(0);
  });
  it('rolls back stock and KIZ if the audit cannot be saved', async () => {
    const f = fixture(); f.tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(f.apply()).rejects.toThrow('audit unavailable');
    expect(f.quantities()).toEqual([1, 0]); expect(f.mark.boxId).toBe(null);
  });
  it('keeps sold-installation legacy behavior with the flag disabled', async () => {
    const f = fixture(); vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'false');
    await f.apply({ action: 'RETURN_TO_STOCK' });
    expect(f.tx.stockBalance.upsert.mock.calls[0][0].create.boxId).toBe('source');
  });
});

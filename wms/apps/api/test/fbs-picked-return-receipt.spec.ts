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
    fbsCargoPlacePacking: { updateMany: vi.fn() }, clientRequestEvent: { create: vi.fn() }, auditLog: { create: vi.fn(), findFirst: vi.fn(async () => null) },
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
  // TEST: a manager records the physical outcome without undoing the original pick.
  it.each(['SHIP_WITH_WB_LABEL', 'AWAIT_RETURN_RECEIPT'])('accepts manager disposition %s without restoring stock', async pickedDisposition => {
    const f = fixture(); const before = structuredClone(f.task); const markBefore = structuredClone(f.mark);
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const result = await f.apply({ action: 'MANAGER_CONFIRMED', comment: 'Фактическое решение', pickedDisposition });
    expect(result.resolved).toBe(true);
    expect(f.quantities()).toEqual([1, 0]); expect(f.mark).toEqual(markBefore);
    expect(f.movements).toEqual([]); expect(fetchMock).not.toHaveBeenCalled();
    expect(f.task).toMatchObject({ kiz: before.kiz, barcode: before.barcode, boxId: before.boxId,
      completedAt: before.completedAt, wbMetaStatus: before.wbMetaStatus });
    expect(f.task.status).toBe(pickedDisposition === 'SHIP_WITH_WB_LABEL' ? 'COMPLETED' : 'RETURN_REQUIRED');
    expect(f.link.syncStatus).toBe(pickedDisposition === 'SHIP_WITH_WB_LABEL' ? 'MANAGER_CONFIRMED_SHIPMENT' : 'MANAGER_CONFIRMED_RETURN');
    expect(f.tx.stockBalance.upsert).not.toHaveBeenCalled();
    expect(f.tx.productMark.updateMany).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: 'FBS_SYNC_CONFLICT_MANAGER_CONFIRMED', payload: expect.objectContaining({ pickedDisposition, stockRestored: false }),
    }) }));
  });
  // TEST: the deferred unit becomes available only on its later physical receipt, even after dispatch.
  it('receives a manager-deferred unit later without restoring it twice', async () => {
    const f = fixture();
    await f.apply({ action: 'MANAGER_CONFIRMED', comment: 'Отложен без этикетки', pickedDisposition: 'AWAIT_RETURN_RECEIPT' });
    expect(f.quantities()).toEqual([1, 0]);
    f.request.status = 'DONE';
    await f.apply();
    expect(f.quantities()).toEqual([0, 1]); expect(f.mark.boxId).toBe('target');
    expect(f.movements).toHaveLength(2);
    await expect(f.apply()).rejects.toThrow();
    expect(f.quantities()).toEqual([0, 1]); expect(f.movements).toHaveLength(2);
  });
  it.each(['SHIP_WITH_WB_LABEL', 'AWAIT_RETURN_RECEIPT'])('retries manager disposition %s without duplicate records', async pickedDisposition => {
    const f = fixture(); const body = { action: 'MANAGER_CONFIRMED', comment: 'Проверено', pickedDisposition };
    await f.apply(body); await f.apply(body);
    expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(f.movements).toEqual([]); expect(f.quantities()).toEqual([1, 0]);
  });
  // TEST: removing dispatch demand at deferral must not subtract another unit on receipt.
  it('subtracts the deferred selection only once across decision and receipt', async () => {
    const f = fixture(); f.tx.clientRequestBoxSelection.findUnique.mockResolvedValue({ id: 'selection', quantity: 3 });
    await f.apply({ action: 'MANAGER_CONFIRMED', comment: 'Отложен', pickedDisposition: 'AWAIT_RETURN_RECEIPT' });
    await f.apply();
    expect(f.tx.clientRequestBoxSelection.update).toHaveBeenCalledTimes(1);
    expect(f.tx.clientRequestBoxSelection.update).toHaveBeenCalledWith({ where: { id: 'selection' }, data: { quantity: { decrement: 1 } } });
  });
  // TEST: a new WB snapshot must not release another unit's selection after deferral.
  it.each(['RETURN_TO_STOCK', 'MANAGER_CONFIRMED'])('keeps selection released when a deferred conflict reopens: %s', async action => {
    const f = fixture(); f.tx.clientRequestBoxSelection.findUnique.mockResolvedValue({ id: 'selection', quantity: 3 });
    const decision = { action: 'MANAGER_CONFIRMED', comment: 'Отложен', pickedDisposition: 'AWAIT_RETURN_RECEIPT' };
    await f.apply(decision);
    f.tx.auditLog.findFirst.mockResolvedValue(f.tx.auditLog.create.mock.calls[0][0].data);
    f.link.syncStatus = 'RETURN_REQUIRED';
    await f.apply(action === 'RETURN_TO_STOCK' ? f.dto : decision);
    expect(f.tx.clientRequestBoxSelection.update).toHaveBeenCalledTimes(1);
    expect(f.quantities()).toEqual(action === 'RETURN_TO_STOCK' ? [0, 1] : [1, 0]);
  });
  // TEST: a previous physical attempt cannot suppress release of the current selection.
  it.each(['older-pick', 'returned', 'reset'])('ignores stale selection-release evidence: %s', async kind => {
    const f = fixture(); f.tx.clientRequestBoxSelection.findUnique.mockResolvedValue({ id: 'selection', quantity: 3 });
    await f.apply({ action: 'MANAGER_CONFIRMED', comment: 'Отложен', pickedDisposition: 'AWAIT_RETURN_RECEIPT' });
    const event = structuredClone(f.tx.auditLog.create.mock.calls[0][0].data);
    if (kind === 'older-pick') event.payload.completedAt = '2026-09-05T10:00:00.000Z';
    else event.action = kind === 'returned' ? 'FBS_SYNC_CONFLICT_RETURNED_TO_STOCK' : 'FBS_ASSEMBLY_ORDER_RESET';
    f.tx.auditLog.findFirst.mockResolvedValue(event); f.link.syncStatus = 'RETURN_REQUIRED';
    await f.apply();
    expect(f.tx.clientRequestBoxSelection.update).toHaveBeenCalledTimes(2);
  });
  it.each([
    { activeWarehouseId: 'foreign' }, { writableWarehouseIds: [] }, { isDemo: true }, { roleCodes: ['CLIENT'] },
  ])('rejects manager decisions outside the permitted scope: %j', async override => {
    const f = fixture();
    await expect(f.apply({ action: 'MANAGER_CONFIRMED', comment: 'Проверено', pickedDisposition: 'AWAIT_RETURN_RECEIPT' }, { ...user, ...override })).rejects.toThrow();
    expect(f.task.status).toBe('RETURN_REQUIRED'); expect(f.movements).toEqual([]);
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('rejects a concurrent task change before acknowledging a pick', async () => {
    const f = fixture();
    f.tx.fbsTsdAssembly.findUnique.mockResolvedValueOnce({ ...f.task }).mockResolvedValue({ ...f.task, updatedAt: new Date('2026-09-07T10:00:00Z') });
    await expect(f.apply({ action: 'MANAGER_CONFIRMED', comment: 'Проверено', pickedDisposition: 'SHIP_WITH_WB_LABEL' })).rejects.toThrow(/изменил|изменён|изменился/);
    expect(f.tx.fbsTsdAssembly.update).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled(); expect(f.movements).toEqual([]);
  });
  it('rolls back workflow acknowledgement if audit recording fails', async () => {
    const f = fixture(); f.tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(f.apply({ action: 'MANAGER_CONFIRMED', comment: 'Проверено', pickedDisposition: 'SHIP_WITH_WB_LABEL' })).rejects.toThrow('audit unavailable');
    expect(f.task.status).toBe('RETURN_REQUIRED'); expect(f.link.syncStatus).toBe('RETURN_REQUIRED');
    expect(f.quantities()).toEqual([1, 0]); expect(f.movements).toEqual([]);
  });
  // TEST: repeat physical pick -> cancellation -> scanned receipt into the SAME storage cell.
  it('empties and refills a permanent cell twice without archiving it or duplicating stock/KIZ', async () => {
    const f = fixture();
    const originalTask = { ...f.task };
    Object.assign(f.target, { id: 'source', zoneId: 'zone' });
    const balances = new Map<string, any>([['initial', { id: 'initial', warehouseId: 'wh',
      clientId: 'client', skuId: 'sku', boxId: 'source', palletId: 'pallet', status: 'AVAILABLE', quantity: 1 }]]);
    f.tx.box.update = vi.fn();
    f.tx.stockMovement.findMany.mockImplementation(async () => f.movements.filter(row =>
      row.status === 'PACKING' || (row.type === 'RETURN' && row.status === 'SHIPPING' && row.quantity < 0)));
    f.tx.stockBalance.findMany.mockImplementation(async ({ where }: any) => [...balances.values()].filter(row =>
      row.warehouseId === where.warehouseId && row.clientId === where.clientId && row.skuId === where.skuId &&
      row.boxId === where.boxId && (typeof where.status === 'string' ? row.status === where.status : where.status.in.includes(row.status))));
    f.tx.stockBalance.delete.mockImplementation(async ({ where }: any) => balances.delete(where.id));
    f.tx.stockBalance.upsert.mockImplementation(async ({ where, create, update }: any) => {
      const existing = balances.get(where.balanceKey);
      balances.set(where.balanceKey, existing ? { ...existing, quantity: existing.quantity + update.quantity.increment }
        : { ...create, id: where.balanceKey });
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      Object.assign(f.task, originalTask, { completedAt: null, status: 'IN_PROGRESS', boxCode: f.target.code });
      Object.assign(f.link, { requestId: 'request', syncStatus: 'RETURN_REQUIRED', lastCategory: 'cancelled' });
      Object.assign(f.mark, { status: 'AVAILABLE', boxId: 'source' });
      await (f.service as any).reserveCompletedWildberriesStock(f.tx, f.task, 'wh');
      expect([...balances.values()]).toEqual([expect.objectContaining({ boxId: null, palletId: null, status: 'PACKING', quantity: 1 })]);
      expect(f.mark).toMatchObject({ boxId: null, status: 'PACKING' });
      Object.assign(f.task, { completedAt: new Date(), status: 'RETURN_REQUIRED' });
      await f.apply();
      expect([...balances.values()]).toEqual([expect.objectContaining({ boxId: 'source', palletId: 'pallet', status: 'AVAILABLE', quantity: 1 })]);
      expect(f.mark).toMatchObject({ id: 'mark', boxId: 'source', status: 'AVAILABLE' });
      expect(f.target).toMatchObject({ status: 'active', palletId: 'pallet', zoneId: 'zone' });
      expect(f.tx.box.update).not.toHaveBeenCalled();
    }
    expect(f.movements).toHaveLength(8);
    expect(new Set(f.movements.map(row => row.idempotencyKey)).size).toBe(8);
  });
  // TEST: production keeps picked reserves outside boxes, including after a prior return.
  it.each([false, true])('receives a boxless reserve after previous attempt %s', async previous => {
    const f = fixture();
    const row = { warehouseId: 'wh', boxId: null, palletId: null, quantity: 1 };
    f.tx.stockMovement.findMany.mockResolvedValue([
      ...(previous ? [{ ...row, boxId: 'earlier', quantity: 1 }, { ...row, boxId: 'earlier', quantity: -1 }] : []), row,
    ]);
    f.tx.stockBalance.findMany.mockImplementation(async ({ where }: any) => where.boxId === null
      ? [{ id: 'packing', ...row, status: 'PACKING' }] : []);
    await f.apply();
    expect(f.quantities()).toEqual([0, 1]);
    expect(f.movements[0]).toMatchObject({ boxId: null, quantity: -1 });
    expect(f.movements[1]).toMatchObject({ boxId: 'target', quantity: 1 });
    expect(f.mark).toMatchObject({ boxId: 'target', status: 'AVAILABLE' });
  });
  // TEST: neither another source's active pick nor contradictory history may be ignored.
  it.each(['another active source', 'negative history'])('rejects %s before changing stock', async fault => {
    const f = fixture();
    f.tx.stockMovement.findMany.mockResolvedValue([
      { warehouseId: 'wh', boxId: 'source', palletId: null, quantity: 1 },
      { warehouseId: 'wh', boxId: 'other', palletId: null, quantity: fault === 'negative history' ? -1 : 1 },
    ]);
    await expect(f.apply()).rejects.toThrow();
    expect(f.tx.stockBalance.delete).not.toHaveBeenCalled();
    expect(f.quantities()).toEqual([1, 0]);
  });
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
  // TEST: disabling new receipts preserves each installation's pre-existing return placement.
  it('preserves installation baseline with the flag disabled', async () => {
    const f = fixture(); vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'false');
    await f.apply({ action: 'RETURN_TO_STOCK' });
    expect(f.tx.stockBalance.upsert.mock.calls[0][0].create.boxId).toBe(process.env.WMS_TEST_OUR_LIVE_BASELINE === 'true' ? null : 'source');
  });
});

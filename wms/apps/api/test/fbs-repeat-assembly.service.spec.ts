import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { FbsRepeatAssemblyService } from '../src/modules/marketplace-connections/fbs-repeat-assembly.service';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { allocateRepeatStock } from '../src/modules/marketplace-connections/fbs-repeat-stock-plan';
import { appendFbsAttemptHistory, readFbsAttemptHistory } from '../src/common/shipment-history/fbs-attempt-history';

// TEST: service orchestration; real PostgreSQL transaction/queue smoke tests
// remain a release gate, these mocks are not a substitute for them.
describe('repeat assembly service safety', () => {
  beforeEach(() => vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED', 'true'));
  afterEach(() => vi.unstubAllEnvs());
  const user: AuthUser = { id: 'admin', name: 'Администратор', email: 'admin', roleCodes: ['ADMIN'],
    permissionCodes: ['clients:write'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [],
    activeWarehouseId: 'moscow', writableWarehouseIds: ['moscow'] };
  function fixture(count = 1) {
    const date = new Date('2026-09-01T10:00:00Z');
    const tasks = Array.from({ length: count }, (_, index) => ({
      id: `attempt-${index}`, clientId: 'client', connectionId: 'wb', orderId: String(100 + index),
      marketplace: 'WILDBERRIES', requestId: 'source', requestItemId: 'old-item', skuId: 'sku',
      productName: 'Костюм', article: 'Артикул', barcodes: ['4600'], itemCount: 1,
      requiresKiz: true, status: 'COMPLETED', barcode: '4600', kiz: `old-kiz-${index}`,
      wbMetaStatus: 'ACCEPTED', completedAt: date, startedAt: date, updatedAt: date,
      workerUserId: 'picker', workerName: 'Соня', deviceCode: 'TSD-01', supplyId: 'WB-GI-1', cargoPacking: null,
    }));
    const source = { id: 'source', number: 222, status: 'DONE', warehouseId: 'moscow', items: [{ id: 'old-item', quantity: count }] };
    const links = tasks.map(task => ({ id: `link-${task.id}`, clientId: 'client', connectionId: 'wb',
      orderId: task.orderId, requestId: 'source', request: source, updatedAt: date, syncStatus: 'ACTIVE' }));
    const balances = [{ id: 'balance', clientId: 'client', warehouseId: 'moscow', skuId: 'sku',
      boxId: 'box', quantity: count, updatedAt: date, box: { id: 'box', code: 'FFL_BOX', warehouseId: 'moscow' } }];
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      client: { findUniqueOrThrow: vi.fn().mockResolvedValue({ isDemo: false, relabelingEnabled: false, stockBalanceMode: 'PALLET_SORT' }) },
      warehouse: { findFirst: vi.fn().mockResolvedValue({ id: 'moscow' }) },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue(tasks), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue(links), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      sku: { findMany: vi.fn().mockResolvedValue([{ id: 'sku', name: 'Костюм', article: 'Артикул',
        internalSku: 'SKU', size: '46', barcodes: [{ value: '4600' }] }]) },
      clientArticleMapping: { findMany: vi.fn().mockResolvedValue([]) },
      stockBalance: { findMany: vi.fn().mockResolvedValue(balances) },
      storagePalletBox: { findMany: vi.fn().mockResolvedValue([{ boxCode: 'FFL_BOX', pallet: { code: 'PALLET_SORT_40' } }]) },
      clientRequest: {
        create: vi.fn().mockImplementation(async ({ data }) => ({ ...data, id: 'repeat', number: 664,
          items: data.items.create.map((item: object, index: number) => ({ ...item, id: `new-item-${index}` })) })),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'repeat', number: 664 }),
      },
      fbsRepeatAssemblyRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
      fbsAssemblyAttemptHistory: { create: vi.fn().mockResolvedValue({}) },
      clientRequestBoxSelection: { upsert: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(),
    };
    db.$transaction.mockImplementation(callback => callback(db));
    const connections = {
      readRepeatAssemblyWbStatuses: vi.fn().mockResolvedValue(new Map(tasks.map(task => [task.orderId, { supplierStatus: 'complete', wbStatus: 'waiting' }]))),
      repeatAssemblyStockReservations: vi.fn().mockResolvedValue(new Map()),
      invalidateRepeatAssemblyCache: vi.fn(),
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new FbsRepeatAssemblyService(db as never, scopes as never, connections as never);
    const dto = { clientId: 'client', orders: tasks.map(task => ({ id: task.orderId, connectionId: 'wb', assemblyId: task.id })) };
    return { service, db, tasks, links, source, balances, connections, scopes, dto };
  }
  async function confirmed(f: ReturnType<typeof fixture>) {
    const preview = await f.service.preview(f.dto, user);
    return { ...f.dto, previewToken: preview.previewToken, confirmAdditionalStockConsumption: true as const };
  }
  it('previews without changing stock, tasks, links or requests', async () => {
    const f = fixture();
    const result = await f.service.preview(f.dto, user);
    expect(result).toMatchObject({ orderCount: 1, additionalUnits: 1,
      orders: [{ id: '100', boxCode: 'FFL_BOX', palletCode: 'PALLET_SORT_40' }] });
    expect(f.db.clientRequest.create).not.toHaveBeenCalled();
    expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
    expect(f.scopes.requireClientAccess).toHaveBeenCalledWith(user, 'client', 'write');
  });
  it('archives the complete old facts and groups repeated SKUs without reducing old items', async () => {
    const f = fixture(2);
    const before = structuredClone({ tasks: f.tasks, source: f.source, balances: f.balances });
    const result = await f.service.create(await confirmed(f), user);
    expect(result.request.id).toBe('repeat');
    expect(f.db.clientRequest.create.mock.calls[0][0].data.items.create).toHaveLength(1);
    expect(f.db.clientRequest.create.mock.calls[0][0].data.items.create[0].quantity).toBe(2);
    expect(f.db.fbsAssemblyAttemptHistory.create).toHaveBeenCalledTimes(2);
    const archive = f.db.fbsAssemblyAttemptHistory.create.mock.calls[0][0].data;
    expect(archive.taskSnapshot).toMatchObject({ id: 'attempt-0', kiz: 'old-kiz-0', workerUserId: 'picker' });
    expect(archive.successorId).not.toBe('attempt-0');
    expect(f.db.fbsTsdAssembly.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'attempt-0', status: 'COMPLETED', updatedAt: f.tasks[0].updatedAt },
      data: { id: archive.successorId, requestId: 'repeat', requestItemId: 'new-item-0',
        kiz: null, workerUserId: null, status: 'RESERVED', reservedBoxId: 'box' },
    });
    expect(f.db.clientRequestBoxSelection.upsert.mock.calls[1][0].update).toEqual({ quantity: { increment: 1 } });
    expect({ tasks: f.tasks, source: f.source, balances: f.balances }).toEqual(before);
    expect(f.db.$transaction.mock.calls.at(-1)?.[1]).toMatchObject({ isolationLevel: 'Serializable' });
    expect(f.db.auditLog.create.mock.calls[0][0].data.payload.wbMutationPerformed).toBe(false);
  });
  it('returns the existing request on a retry, without checking/mutating the new attempt', async () => {
    const f = fixture(); const dto = await confirmed(f);
    f.db.fbsRepeatAssemblyRun.findUnique.mockResolvedValue({ requestId: 'repeat' });
    const wbCalls = f.connections.readRepeatAssemblyWbStatuses.mock.calls.length;
    expect(await f.service.create(dto, user)).toMatchObject({ status: 'ALREADY_EXISTS', request: { id: 'repeat' } });
    expect(f.db.clientRequest.create).not.toHaveBeenCalled();
    expect(f.connections.readRepeatAssemblyWbStatuses).toHaveBeenCalledTimes(wbCalls);
  });
  it('rejects cancellation between preview and creation', async () => {
    const f = fixture(); const dto = await confirmed(f);
    f.connections.readRepeatAssemblyWbStatuses.mockResolvedValue(new Map([['100', { supplierStatus: 'cancel', wbStatus: 'canceled' }]]));
    await expect(f.service.create(dto, user)).rejects.toThrow('WB');
    expect(f.db.clientRequest.create).not.toHaveBeenCalled();
  });
  it('rejects a changed snapshot or a newer task before creating a request', async () => {
    const f = fixture(); const dto = await confirmed(f);
    f.tasks[0].updatedAt = new Date('2026-09-05');
    await expect(f.service.create(dto, user)).rejects.toThrow('изменились');
    expect(f.db.clientRequest.create).not.toHaveBeenCalled();
  });
  it('propagates a task CAS failure to roll back the transaction instead of moving the link', async () => {
    const f = fixture(); const dto = await confirmed(f);
    f.db.fbsTsdAssembly.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.service.create(dto, user)).rejects.toThrow('все изменения отменены');
    expect(f.db.fbsOrderRequestLink.updateMany).not.toHaveBeenCalled();
    expect(f.connections.invalidateRepeatAssemblyCache).not.toHaveBeenCalled();
  });
  it('rejects missing physical stock and respects current reservations', async () => {
    const f = fixture();
    f.connections.repeatAssemblyStockReservations.mockResolvedValue(new Map([['sku', [{ boxId: 'box', itemCount: 1 }]]]));
    await expect(f.service.preview(f.dto, user)).rejects.toThrow('Недостаточно');
    expect(f.db.clientRequest.create).not.toHaveBeenCalled();
  });
  it('rejects stock without a pallet-sort when the client uses pallet-sort stock', async () => {
    const f = fixture(); f.db.storagePalletBox.findMany.mockResolvedValue([]);
    await expect(f.service.preview(f.dto, user)).rejects.toThrow('Недостаточно');
  });
  it('does not allow an operator or another branch', async () => {
    const f = fixture();
    await expect(f.service.preview(f.dto, { ...user, roleCodes: ['TSD'] })).rejects.toThrow('администратор');
    await expect(f.service.preview(f.dto, { ...user, activeWarehouseId: 'other' })).rejects.toThrow('филиал');
    expect(f.connections.readRepeatAssemblyWbStatuses).not.toHaveBeenCalled();
  });
  it('does not create without explicit additional consumption approval or a previous attempt id', async () => {
    const f = fixture(); const dto = await confirmed(f);
    await expect(f.service.create({ ...dto, confirmAdditionalStockConsumption: false }, user)).rejects.toThrow('Подтвердите');
    await expect(f.service.create({ ...dto, orders: [{ id: '100', connectionId: 'wb' }] }, user)).rejects.toThrow('предварительную');
    expect(f.db.clientRequest.create).not.toHaveBeenCalled();
  });
});

describe('repeat stock matching', () => {
  it('does not double-allocate a single physical unit', () => {
    expect(() => allocateRepeatStock([{ id: '1', candidateSkuIds: ['a'] }, { id: '2', candidateSkuIds: ['a'] }],
      [{ id: 'balance', skuId: 'a', boxId: 'box', quantity: 1 }])).toThrow('Недостаточно');
  });
  it('keeps the exact SKU for an order without a relabel alternative', () => {
    const plan = allocateRepeatStock([{ id: 'flexible', candidateSkuIds: ['a', 'b'] }, { id: 'exact', candidateSkuIds: ['a'] }],
      [{ id: 'a', skuId: 'a', boxId: 'box', quantity: 1 }, { id: 'b', skuId: 'b', boxId: 'box', quantity: 1 }]);
    expect(plan.get('exact')!.skuId).toBe('a'); expect(plan.get('flexible')!.skuId).toBe('b');
  });
});

describe('historical output stays visible', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('leaves sold/default installations completely untouched', async () => {
    vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED', '');
    await expect(readFbsAttemptHistory({} as never, {})).resolves.toEqual([]);
  });
  it('includes the prior worker/day once, even after pausing creation', async () => {
    vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED', 'read-only');
    const task = { id: 'old', status: 'COMPLETED', workerUserId: 'Соня',
      completedAt: '2026-09-01T09:00:00.000Z', startedAt: '2026-09-01T08:59:00.000Z' };
    const db = { fbsAssemblyAttemptHistory: { findMany: vi.fn().mockResolvedValue([{ taskSnapshot: task, linkSnapshot: {}, successorId: 'new' }]) } };
    const rows = [{ id: 'new' }];
    await appendFbsAttemptHistory(db as never, rows, { clientId: 'client' });
    await appendFbsAttemptHistory(db as never, rows, { clientId: 'client' });
    expect(rows.map(row => row.id)).toEqual(['new', 'old']);
    expect(rows[1]).toMatchObject({ workerUserId: 'Соня', completedAt: new Date(task.completedAt) });
  });
});

// TEST: exercise the existing WMS sync/duplicate guards, not only the new service.
describe('repeat integration with existing synchronization', () => {
  beforeEach(() => vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED', 'true'));
  afterEach(() => vi.unstubAllEnvs());
  function synchronizationFixture(repeat = false) {
    const task = { id: 'old-attempt', requestId: 'request', orderId: '100', clientId: 'client',
      skuId: 'sku', barcodes: ['4600'], barcode: '4600', productName: 'Костюм', itemCount: 1,
      status: 'COMPLETED', kiz: 'previous-kiz', completedAt: new Date().toISOString() };
    const request = { id: 'request', status: 'IN_WORK', title: 'Повторная сборка WB — 1 заказов',
      comment: 'Исходная заявка №222, WB-GI-1. Дополнительный расход подтверждён.',
      fbsOrderLinks: [], items: [{ id: 'item', skuId: 'sku', name: 'Костюм', barcode: '4600',
        quantity: 1, comment: '', packageItems: [], boxSelections: [] }] };
    const db = {
      clientRequest: { findUnique: vi.fn().mockResolvedValue(request), update: vi.fn().mockResolvedValue({}) },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
      fbsOrderRequestLink: { findUnique: vi.fn().mockRejectedValue(new Error('must not auto-add orders to a repeat')) },
      fbsRepeatAssemblyRun: { findUnique: vi.fn().mockResolvedValue(repeat ? { id: 'repeat-run' } : null) },
      fbsAssemblyAttemptHistory: { findMany: vi.fn().mockResolvedValue([{ taskSnapshot: task, linkSnapshot: {}, successorId: 'next' }]) },
      clientRequestItem: { update: vi.fn().mockResolvedValue({}), delete: vi.fn() },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(),
    };
    db.$transaction.mockImplementation(callback => callback(db));
    const service = new MarketplaceConnectionsService(db as never, {} as never);
    return { service, db, request };
  }
  it('does not shrink or cancel an original request after its current link moved away', async () => {
    const f = synchronizationFixture();
    await (f.service as any).syncOneFbsRequest('client', 'request', new Map(), []);
    expect(f.db.clientRequestItem.delete).not.toHaveBeenCalled();
    expect(f.db.clientRequestItem.update.mock.calls.every(([args]) => args.data.quantity === 1)).toBe(true);
    expect(f.db.clientRequest.update.mock.calls.every(([args]) => args.data.status !== 'CANCELLED')).toBe(true);
  });
  it('does not auto-add unrelated WB orders or erase repeat provenance on refresh', async () => {
    const f = synchronizationFixture(true);
    await (f.service as any).syncOneFbsRequest('client', 'request', new Map(), [{ id: 'unrelated', marketplace: 'WILDBERRIES', connectionId: 'wb' }]);
    expect(f.db.fbsOrderRequestLink.findUnique).not.toHaveBeenCalled();
    expect(f.db.clientRequest.update.mock.calls.every(([args]) => !args.data.comment || args.data.comment === f.request.comment)).toBe(true);
    expect(f.db.clientRequest.update.mock.calls.every(([args]) => !args.data.title || args.data.title.startsWith('Повторная сборка'))).toBe(true);
  });
  it('rejects a KIZ from a prior attempt even without old shipping or printing evidence', async () => {
    const db = { fbsTsdAssembly: { findFirst: vi.fn().mockResolvedValue(null) },
      shippedKizHistory: { findFirst: vi.fn().mockResolvedValue(null) },
      fbsWebKizStickerPrint: { findFirst: vi.fn().mockResolvedValue(null) },
      fbsAssemblyAttemptHistory: { findFirst: vi.fn().mockResolvedValue({ orderId: '100', requestId: 'old', completedAt: new Date() }) } };
    const service = new MarketplaceConnectionsService(db as never, {} as never);
    expect(await (service as any).findPreviousWildberriesKizUsage('client', 'previous-kiz', 'new-attempt'))
      .toMatchObject({ source: 'ASSEMBLY', orderId: '100', requestId: 'old' });
  });
});

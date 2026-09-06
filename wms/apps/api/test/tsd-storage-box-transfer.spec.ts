import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxCodePolicyService } from '../src/common/boxes/box-code-policy.service';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

// TEST: box → barcode → KIZ → storage box, using the real stock transfer service.
const barcode = '2040000000001';
const kiz = '010460000000000121SERIAL-00001';
const user = {
  id: 'worker-1', deviceCode: 'TSD-01', roleCodes: ['OPERATOR'],
  permissionCodes: ['stock:write'], activeWarehouseId: 'wh-1',
  writableWarehouseIds: ['wh-1'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [],
} as any;

// TEST: retain configurable source codes and quantities for both merged workflows.
function fixture(initialMarkBox = 'source', markValue = kiz, storageBoxAliases: string[] = [], sourceCode = 'FFL_SOURCE', quantity = 2) {
  let sourceQuantity = quantity;
  let targetQuantity = 0;
  let markBoxId = initialMarkBox;
  const oldBox = { id: 'old', code: 'FFL_OLD', clientId: 'client-1', warehouseId: 'wh-1', status: 'active' };
  const oldBalances: any[] = [];
  const auditRows: any[] = [];
  const addedMarks: any[] = [];
  const mark = { id: 'mark-1', clientId: 'client-1', skuId: 'sku-1', value: markValue,
    status: 'AVAILABLE', stockMovementId: 'receipt-1', updatedAt: new Date('2026-07-20') };
  const sku = { id: 'sku-1', clientId: 'client-1', name: 'Костюм', internalSku: 'SKU-1',
    needsChestnyZnak: true, isUnmarked: false, barcodes: [{ value: barcode }] };
  const balance = () => ({ id: 'source-balance', skuId: sku.id, clientId: 'client-1',
    warehouseId: 'wh-1', boxId: 'source', status: 'AVAILABLE', quantity: sourceQuantity, sku });
  const source = () => ({ id: 'source', code: sourceCode, clientId: 'client-1',
    warehouseId: 'wh-1', status: 'active', client: { id: 'client-1' }, balances: [balance()] });
  const target = { id: 'target', code: 'SBOX_001', clientId: 'client-1', warehouseId: 'wh-1', status: 'active' };
  const movements = new Map<string, any>();
  // TEST: model newly registered marks as well as the pre-existing mark.
  const matchesMark = (row: any, where: any): boolean => {
    if (where.OR && !where.OR.some((part: any) => matchesMark(row, part))) return false;
    for (const key of ['clientId', 'skuId', 'boxId', 'status']) {
      if (where[key] && typeof where[key] === 'string' && row[key] !== where[key]) return false;
      if (where[key]?.not && row[key] === where[key].not) return false;
    }
    if (typeof where.value === 'object' && where.value?.startsWith !== undefined) return row.value.startsWith(where.value.startsWith);
    if (where.value !== undefined) return row.value === (where.value?.equals ?? where.value);
    return true;
  };
  const marks = () => [{ ...mark, boxId: markBoxId }, ...addedMarks];
  const db = {
    box: {
      findUnique: vi.fn(async ({ where }: any) => {
        const code = where.code ?? where.clientId_code?.code;
        if (where.id === 'old') return oldBox;
        if (where.id === 'target') return target;
        if (where.id === 'source') return source();
        return code === sourceCode ? source() : code === target.code ? target : null;
      }),
      create: vi.fn(), update: vi.fn(),
    },
    sku: { findFirst: vi.fn(async () => sku) },
    productMark: {
      findMany: vi.fn(async ({ where }: any) => marks().filter(row => matchesMark(row, where))),
      findFirst: vi.fn(async ({ where }: any) => marks().find(row => matchesMark(row, where)) ?? null),
      count: vi.fn(async ({ where }: any) => marks().filter(row => matchesMark(row, where)).length),
      create: vi.fn(async ({ data }: any) => {
        const row = { ...data, id: `new-mark-${addedMarks.length}` };
        addedMarks.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        if (where.id === mark.id) markBoxId = data.boxId;
        else Object.assign(addedMarks.find(row => row.id === where.id)!, data);
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.boxId !== markBoxId || where.status !== mark.status ||
            (where.skuId && where.skuId !== mark.skuId) || where.updatedAt !== mark.updatedAt) return { count: 0 };
        markBoxId = data.boxId;
        if (data.skuId) mark.skuId = data.skuId;
        if (data.stockMovementId) mark.stockMovementId = data.stockMovementId;
        return { count: 1 };
      }),
    },
    stockBalance: {
      findFirst: vi.fn(async ({ where }: any) => where.boxId === 'old'
        ? oldBalances.find(row => row.quantity !== 0) ?? null
        : where.boxId === 'target' ? (targetQuantity > 0 ? { quantity: targetQuantity } : null) : balance()),
      update: vi.fn(async ({ data }: any) => {
        sourceQuantity -= data.quantity.decrement;
        return balance();
      }),
      upsert: vi.fn(async ({ create }: any) => { targetQuantity += create.quantity; return { quantity: targetQuantity }; }),
      delete: vi.fn(),
      aggregate: vi.fn(async () => ({ _sum: { quantity: sourceQuantity } })),
    },
    stockMovement: {
      findFirst: vi.fn(async ({ where }: any) => [...movements.values()].find(row =>
        row.idempotencyKey.startsWith(where.idempotencyKey.startsWith)) ?? null),
      findUnique: vi.fn(async ({ where }: any) => (where.id
        ? [...movements.values()].find(row => row.id === where.id)
        : movements.get(where.idempotencyKey)) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { ...data, id: `movement-${movements.size}`, sku, box: target };
        movements.set(data.idempotencyKey, row);
        return row;
      }),
    },
    fbsTsdAssembly: { findFirst: vi.fn(async (_args: any): Promise<any> => null), findMany: vi.fn(async (): Promise<any[]> => []) },
    shippedKizHistory: { findFirst: vi.fn(async (_args: any): Promise<any> => null), findMany: vi.fn(async (): Promise<any[]> => []) },
    fbsWebKizStickerPrint: { findFirst: vi.fn(async (_args: any): Promise<any> => null), findMany: vi.fn(async (): Promise<any[]> => []) },
    clientMarketplaceConnection: { findUnique: vi.fn(async (): Promise<any> => ({ id: 'connection-1', clientId: 'client-1', marketplace: 'WILDBERRIES', isActive: true, apiKey: 'test-only-key' })) },
    auditLog: { create: vi.fn(async ({ data }: any) => { auditRows.push(data); return data; }) },
    $transaction: vi.fn(async (fn: any) => {
      const before = { sourceQuantity, targetQuantity, markBoxId, mark: { ...mark }, movements: new Map(movements), audits: [...auditRows], addedMarks: addedMarks.map(row => ({ ...row })) };
      try { return await fn(db); } catch (error) {
        ({ sourceQuantity, targetQuantity, markBoxId } = before);
        Object.assign(mark, before.mark);
        movements.clear(); before.movements.forEach((value, key) => movements.set(key, value));
        auditRows.splice(0, auditRows.length, ...before.audits);
        addedMarks.splice(0, addedMarks.length, ...before.addedMarks);
        throw error;
      }
    }),
  };
  const codes = new BoxCodePolicyService({ get: vi.fn(async () => ({ storageBoxPrefix: 'SBOX_', storageBoxAliases })) } as never);
  const scopes = { requireClientAccess: vi.fn() };
  const service = new StockOperationsService(db as never, scopes as never,
    { balanceKey: () => 'target-key' } as never, undefined, undefined, undefined, codes);
  const payload = { transferMode: 'BOX_TO_STORAGE_BOX', fromBoxCode: sourceCode,
    toBoxCode: 'SBOX_001', barcode, scanCode: markValue, idempotencyKey: 'move-1' };
  return { service, codes, db, sku, target, payload, scopes, oldBox, oldBalances, mark, auditRows, addedMarks,
    quantities: () => [sourceQuantity, targetQuantity], markBox: () => markBoxId };
}

// TEST: empty permanent storage remains placed; the exact mark moves once, without new stock.
describe('permanent storage box lifecycle', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('keeps the last-unit source active through the Android batch endpoint and its retry', async () => {
    // TEST: Android batch transfer preserves both source placement and exact target mark.
    vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'true');
    const f = fixture('source', kiz, ['FFL_LKBBOX'], 'FFL_LKBBOX_014', 1);
    f.target.code = 'FFL_TARGET';
    const payload = { fromBoxCode: 'FFL_LKBBOX_014', toBoxCode: 'FFL_TARGET', scanCodes: [kiz], idempotencyKey: 'batch-1' };
    await expect(f.service.executeTsdTransferBatch(payload, user)).resolves.toMatchObject({ sourceBoxArchived: false, sourceRemaining: 0 });
    await expect(f.service.executeTsdTransferBatch(payload, user)).resolves.toMatchObject({ status: 'ALREADY_APPLIED', sourceBoxArchived: false });
    expect(f.quantities()).toEqual([0, 1]);
    expect(f.markBox()).toBe('target');
    expect(f.db.box.update).not.toHaveBeenCalled();
  });
  it.each([
    ['true', 'FFL_LKBBOX_014', false],
    ['true', 'SBOX_014', false],
    ['true', 'FFL_SOURCE', true],
    ['false', 'FFL_LKBBOX_014', true],
  ])('flag %s source %s archived %s', async (flag, sourceCode, archived) => {
    vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', flag as string);
    const f = fixture('source', kiz, ['FFL_LKBBOX'], sourceCode as string, 1);
    const result = await f.service.executeTsdTransfer(f.payload, user);
    expect(result).toMatchObject({ sourceRemaining: 0, sourceBoxArchived: archived });
    expect(f.quantities()).toEqual([0, 1]);
    expect(f.markBox()).toBe('target');
    expect(f.db.productMark.create).not.toHaveBeenCalled();
    if (!archived) expect(f.db.box.update).not.toHaveBeenCalled();
    await f.service.executeTsdTransfer(f.payload, user);
    expect(f.quantities()).toEqual([0, 1]);
  });
});

// TEST: automatic source discovery must never manufacture or double-move stock.
describe('KIZ → storage box with automatic source', () => {
  const setup = () => {
    const f = fixture();
    f.payload.transferMode = 'KIZ_TO_STORAGE_BOX';
    return f;
  };
  it('asks for KIZ without requiring a source scan', async () => {
    const f = setup();
    await expect(f.service.inspectTsdTransferItem({ transferMode: f.payload.transferMode, scanCode: barcode }, user))
      .resolves.toMatchObject({ state: 'SCAN_KIZ' });
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  });
  it('discovers the registered source from KIZ, then moves exactly one unit', async () => {
    const f = setup();
    await expect(f.service.inspectTsdTransferItem({ ...f.payload, fromBoxCode: undefined }, user))
      .resolves.toMatchObject({ state: 'SCAN_TARGET', sourceBox: { code: 'FFL_SOURCE' } });
    expect(f.quantities()).toEqual([2, 0]);
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.markBox()).toBe('target');
    expect(f.db.productMark.create).not.toHaveBeenCalled();
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
  });
  it('matches scanner GS forms by case-sensitive GTIN and serial', async () => {
    const f = setup();
    await expect(f.service.inspectTsdTransferItem({ ...f.payload, fromBoxCode: undefined,
      scanCode: `]d2${kiz}<GS>91TEST<GS>92CRYPTO` }, user))
      .resolves.toMatchObject({ state: 'SCAN_TARGET', item: { skuId: 'sku-1', scanType: 'KIZ' } });
  });
  it.each(['unknown', 'wrong barcode', 'reserved', 'shipped', 'ambiguous', 'no source', 'foreign warehouse',
    'foreign client', 'assembly', 'printed', 'shipment history', 'source changed', 'CAS race'])('rejects %s without mutations', async fault => {
    const f = setup();
    if (fault === 'unknown') f.payload.scanCode = '010460000000000121OTHER-SERIAL';
    if (fault === 'wrong barcode') f.payload.barcode = '999999';
    if (fault === 'reserved') f.mark.status = 'RESERVED';
    if (fault === 'shipped') f.mark.status = 'SHIPPING';
    if (fault === 'ambiguous') f.addedMarks.push({ ...f.mark, id: 'mark-2', boxId: 'source' });
    if (fault === 'no source') f.db.productMark.findMany.mockResolvedValue([{ ...f.mark, boxId: null }] as any);
    if (fault === 'foreign warehouse') f.db.box.findUnique.mockResolvedValue({ id: 'source', code: 'FFL_SOURCE', clientId: 'client-1', warehouseId: 'wh-2', status: 'active', balances: [] } as any);
    if (fault === 'foreign client') f.scopes.requireClientAccess.mockImplementation(() => { throw new Error('Нет доступа к клиенту'); });
    if (fault === 'assembly') f.db.fbsTsdAssembly.findFirst.mockResolvedValue({ id: 'task' });
    if (fault === 'printed') f.db.fbsWebKizStickerPrint.findFirst.mockResolvedValue({ id: 'print' });
    if (fault === 'shipment history') f.db.shippedKizHistory.findFirst.mockResolvedValue({ id: 'shipment' });
    if (fault === 'source changed') f.db.productMark.findMany.mockResolvedValue([{ ...f.mark, boxId: 'target' }] as any);
    if (fault === 'CAS race') f.db.productMark.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.markBox()).toBe('source');
    expect(f.db.productMark.create).not.toHaveBeenCalled();
    expect(await f.db.stockMovement.findUnique({ where: { idempotencyKey: 'move-1:out' } })).toBeNull();
  });
  it.each(['toBoxCode', 'barcode', 'scanCode'])('does not reuse a completed key for another %s', async field => {
    const f = setup();
    await f.service.executeTsdTransfer(f.payload, user);
    await expect(f.service.executeTsdTransfer({ ...f.payload, [field]: field === 'toBoxCode' ? 'SBOX_002' : 'changed' }, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([1, 1]);
  });
  it('archives a source after the last unit, and does not recreate it on retry', async () => {
    const f = fixture('source', kiz, [], 'FFL_SOURCE', 1);
    f.payload.transferMode = 'KIZ_TO_STORAGE_BOX';
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ sourceBoxArchived: true });
    expect(f.quantities()).toEqual([0, 1]);
    expect(f.db.box.update).toHaveBeenCalledWith({ where: { id: 'source' }, data: { status: 'archived' } });
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(f.quantities()).toEqual([0, 1]);
  });
  it('rolls back both balances, KIZ and ledger if final archiving fails', async () => {
    const f = fixture('source', kiz, [], 'FFL_SOURCE', 1);
    f.payload.transferMode = 'KIZ_TO_STORAGE_BOX';
    f.db.box.update.mockRejectedValue(new Error('archive unavailable'));
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow('archive unavailable');
    expect(f.quantities()).toEqual([1, 0]);
    expect(f.markBox()).toBe('source');
    expect(await f.db.stockMovement.findUnique({ where: { idempotencyKey: 'move-1:in' } })).toBeNull();
  });
  it('rechecks reservation after successful read-only inspection', async () => {
    const f = setup();
    await f.service.inspectTsdTransferItem(f.payload, user);
    f.mark.status = 'RESERVED';
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow('зарезервирован');
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  });
});

// TEST: a different KIZ in an old cancelled return task must not freeze all stock of the SKU.
describe('unregistered KIZ with a cancelled source-box return task', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const setup = () => {
    vi.stubEnv('WMS_TSD_CANCELLED_BOX_TASK_TRANSFER_ENABLED', 'true');
    const f = fixture();
    f.payload.scanCode = '0104600000000001215NEW-serial01\u001d91TEST\u001d92CRYPTO';
    const task = { id: 'return-task', clientId: 'client-1', marketplace: 'WILDBERRIES',
      connectionId: 'connection-1', orderId: '5545446176', status: 'RETURN_REQUIRED',
      kiz, updatedAt: new Date('2026-09-01'), boxId: 'source', reservedBoxId: 'source', skuId: 'sku-1', sourceSkuId: 'sku-1' };
    f.db.fbsTsdAssembly.findMany.mockImplementation(async () => [{ ...task }]);
    f.db.fbsTsdAssembly.findFirst.mockImplementation(async ({ where }: any) => where.AND && !where.id?.notIn?.includes(task.id) ? { ...task } : null);
    const remote = vi.fn(async () => new Response(JSON.stringify({ orders: [{ id: 5545446176, supplierStatus: 'complete', wbStatus: 'canceled_by_client' }] })));
    vi.stubGlobal('fetch', remote);
    return { ...f, task, remote };
  };
  it('checks WB, registers a new mark and moves one unit without rewriting the old task', async () => {
    const f = setup();
    await expect(f.service.inspectTsdTransferItem(f.payload, user)).resolves.toMatchObject({ state: 'SCAN_TARGET' });
    expect(f.addedMarks).toHaveLength(0);
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.addedMarks).toHaveLength(1);
    expect(f.task.status).toBe('RETURN_REQUIRED');
    expect(f.auditRows.some(row => row.action === 'TSD_CANCELLED_BOX_TASK_TRANSFER')).toBe(true);
    const calls = f.remote.mock.calls.length;
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(f.remote).toHaveBeenCalledTimes(calls);
  });
  it.each(['active', 'sold', 'WB unavailable', 'race', 'own history', 'flag off',
    'same KIZ', 'missing KIZ', 'foreign client', 'other marketplace', 'missing connection',
    'too many tasks', 'duplicate WB status', 'missing WB status', 'expired proof', 'new task'])('retains protection for %s', async fault => {
    const f = setup();
    if (fault === 'active') f.task.status = 'IN_PROGRESS';
    if (fault === 'sold') f.remote.mockImplementation(async () => new Response(JSON.stringify({ orders: [{ id: 5545446176, supplierStatus: 'complete', wbStatus: 'sold' }] })));
    if (fault === 'WB unavailable') f.remote.mockImplementation(async () => { throw new Error('offline'); });
    if (fault === 'race') f.remote.mockImplementation(async () => { f.task.updatedAt = new Date(); return new Response(JSON.stringify({ orders: [{ id: 5545446176, supplierStatus: 'complete', wbStatus: 'canceled_by_client' }] })); });
    if (fault === 'own history') f.db.shippedKizHistory.findFirst.mockResolvedValue({ id: 'shipment' });
    if (fault === 'flag off') vi.stubEnv('WMS_TSD_CANCELLED_BOX_TASK_TRANSFER_ENABLED', 'false');
    if (fault === 'same KIZ') f.task.kiz = f.payload.scanCode;
    if (fault === 'missing KIZ') f.task.kiz = '';
    if (fault === 'foreign client') f.task.clientId = 'other';
    if (fault === 'other marketplace') f.task.marketplace = 'OZON';
    if (fault === 'missing connection') f.db.clientMarketplaceConnection.findUnique.mockResolvedValue(null);
    if (fault === 'too many tasks') f.db.fbsTsdAssembly.findMany.mockResolvedValue(Array.from({ length: 11 }, (_, i) => ({ ...f.task, id: `task-${i}` })));
    if (fault === 'duplicate WB status') f.remote.mockImplementation(async () => new Response(JSON.stringify({ orders: [1, 2].map(() => ({ id: 5545446176, supplierStatus: 'complete', wbStatus: 'canceled_by_client' })) })));
    if (fault === 'missing WB status') f.remote.mockImplementation(async () => new Response('{"orders":[]}'));
    if (fault === 'expired proof') {
      const original = f.db.$transaction.getMockImplementation()!;
      f.db.$transaction.mockImplementation(async fn => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16_000);
        try { return await original(fn); } finally { clock.mockRestore(); }
      });
    }
    if (fault === 'new task') f.remote.mockImplementation(async () => {
      f.db.fbsTsdAssembly.findMany.mockResolvedValue([{ ...f.task }, { ...f.task, id: 'new-task', status: 'IN_PROGRESS' }]);
      return new Response(JSON.stringify({ orders: [{ id: 5545446176, supplierStatus: 'complete', wbStatus: 'canceled_by_client' }] }));
    });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.addedMarks).toHaveLength(0);
  });
  it('performs the bounded WB request outside the stock transaction and rolls back on audit failure', async () => {
    const f = setup();
    let inTransaction = false;
    const original = f.db.$transaction.getMockImplementation()!;
    f.db.$transaction.mockImplementation(async fn => { inTransaction = true; try { return await original(fn); } finally { inTransaction = false; } });
    f.remote.mockImplementation(async () => {
      expect(inTransaction).toBe(false);
      return new Response(JSON.stringify({ orders: [{ id: 5545446176, supplierStatus: 'complete', wbStatus: 'canceled_by_client' }] }));
    });
    f.db.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow('audit unavailable');
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.addedMarks).toHaveLength(0);
    expect(f.remote).toHaveBeenCalledOnce();
  });
});

// TEST: the real stock service must read live cancellation, not trust a stale SHIPPING flag.
describe('TSD cancelled WB order physical transfer', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const cancelledFixture = () => {
    vi.stubEnv('WMS_TSD_CANCELLED_WB_TRANSFER_ENABLED', 'true');
    const f = fixture('old');
    f.mark.status = 'SHIPPING';
    const task = { id: 'assembly-1', clientId: 'client-1', marketplace: 'WILDBERRIES',
      connectionId: 'connection-1', orderId: '5544665829', kiz, status: 'COMPLETED', updatedAt: new Date('2026-08-24') };
    f.db.fbsTsdAssembly.findMany.mockResolvedValue([task]);
    f.db.shippedKizHistory.findMany.mockResolvedValue([{ id: 'history-1', assemblyId: task.id,
      clientId: task.clientId, orderId: task.orderId, kiz }]);
    const remote = vi.fn(async () => new Response(JSON.stringify({ orders: [{ id: 5544665829,
      supplierStatus: 'cancel', wbStatus: 'canceled' }] }), { status: 200 }));
    vi.stubGlobal('fetch', remote);
    return { ...f, remote, task };
  };

  it('checks during inspection and before movement; preserves historical status and total quantity', async () => {
    const f = cancelledFixture();
    await expect(f.service.inspectTsdTransferItem(f.payload, user)).resolves.toMatchObject({ state: 'SCAN_TARGET' });
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
    expect(f.markBox()).toBe('old');
    expect(f.remote).toHaveBeenCalledTimes(1);
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.remote).toHaveBeenCalledTimes(2);
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.markBox()).toBe('target');
    expect(f.mark.status).toBe('SHIPPING');
    expect(f.db.productMark.create).not.toHaveBeenCalled();
    expect(f.auditRows).toEqual([expect.objectContaining({ action: 'TSD_CANCELLED_WB_PHYSICAL_TRANSFER',
      payload: expect.objectContaining({ orderId: '5544665829', wbStatus: 'canceled', quantity: 1 }) })]);
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(f.remote).toHaveBeenCalledTimes(2);
    expect(f.quantities()).toEqual([1, 1]);
  });

  it.each(['sold', 'waiting', 'unknown'])('keeps stock untouched when WB reports %s', async wbStatus => {
    const f = cancelledFixture();
    f.remote.mockResolvedValue(new Response(JSON.stringify({ orders: [{ id: 5544665829,
      supplierStatus: 'complete', wbStatus }] }), { status: 200 }));
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/WB/);
    expect(f.remote).toHaveBeenCalledTimes(1);
    expect(f.quantities()).toEqual([2, 0]);
  });

  // TEST: a new operation ID must not consume a second unit for the same relocated physical KIZ.
  it('rejects another operation from the old physical source after a completed relocation', async () => {
    const f = cancelledFixture();
    await f.service.executeTsdTransfer(f.payload, user);
    await expect(f.service.executeTsdTransfer({ ...f.payload, idempotencyKey: 'move-again' }, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.db.stockMovement.create).toHaveBeenCalledTimes(2);
  });

  it('rechecks WB after inspection instead of accepting client-supplied confirmation', async () => {
    const f = cancelledFixture();
    await f.service.inspectTsdTransferItem(f.payload, user);
    f.remote.mockResolvedValue(new Response(JSON.stringify({ orders: [{ id: 5544665829,
      supplierStatus: 'complete', wbStatus: 'sold' }] }), { status: 200 }));
    await expect(f.service.executeTsdTransfer({ ...f.payload, cancelledWbTransfer: { wbStatus: 'canceled' } }, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([2, 0]);
  });

  it.each([401, 429, 500])('does not treat WB HTTP %s as cancellation', async status => {
    const f = cancelledFixture(); f.remote.mockResolvedValue(new Response('{}', { status }));
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/проверить.*WB/);
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  });

  it('does not call WB inside a stock transaction', async () => {
    const f = cancelledFixture(); let inside = false;
    const original = f.db.$transaction.getMockImplementation()!;
    f.db.$transaction.mockImplementation(async fn => { inside = true; try { return await original(fn); } finally { inside = false; } });
    f.remote.mockImplementation(async () => { expect(inside).toBe(false); return new Response(JSON.stringify({ orders: [{ id: 5544665829, supplierStatus: 'cancel', wbStatus: 'canceled' }] })); });
    await f.service.executeTsdTransfer(f.payload, user);
  });

  it.each(['audit', 'mark race', 'task race'])('rolls back or blocks on %s', async fault => {
    const f = cancelledFixture();
    if (fault === 'audit') f.db.auditLog.create.mockRejectedValue(new Error('audit failed'));
    if (fault === 'mark race') f.db.productMark.updateMany.mockResolvedValue({ count: 0 });
    if (fault === 'task race') f.remote.mockImplementation(async () => { f.task.updatedAt = new Date(); return new Response(JSON.stringify({ orders: [{ id: 5544665829, supplierStatus: 'cancel', wbStatus: 'canceled' }] })); });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
    expect(f.remote).toHaveBeenCalledTimes(1);
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.markBox()).toBe('old');
    expect(f.auditRows).toEqual([]);
  });

  it('does not enable this behavior on other installations or ordinary transfers', async () => {
    const f = cancelledFixture(); vi.stubEnv('WMS_TSD_CANCELLED_WB_TRANSFER_ENABLED', 'false');
    await expect(f.service.inspectTsdTransferItem(f.payload, user)).rejects.toThrow(/недоступен/);
    vi.stubEnv('WMS_TSD_CANCELLED_WB_TRANSFER_ENABLED', 'true');
    await expect(f.service.inspectTsdTransferItem({ ...f.payload, transferMode: undefined }, user)).rejects.toThrow();
    expect(f.remote).not.toHaveBeenCalled();
  });
});

describe('TSD storage-box transfer', () => {
  // TEST: the configured alias works through actual transfer validation, without duplicate stock.
  it('transfers to an FFL_LKBBOX destination using an explicitly enabled alias', async () => {
    const f = fixture('source', kiz, ['FFL_LKBBOX']);
    f.target.code = 'FFL_LKBBOX001';
    f.payload.toBoxCode = 'ffl_lkbbox001';
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.markBox()).toBe('target');
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
  });

  it('accepts the configured storage prefix without loosening ordinary box validation', async () => {
    const { codes } = fixture();
    await expect((codes as any).requireStorageBox(' sbox_001 ')).resolves.toBe('SBOX_001');
    await expect(codes.requireAllowed('SBOX_001')).rejects.toThrow();
  });

  it('requires barcode then KIZ, without mutating marks during inspection', async () => {
    const { service, db, payload } = fixture();
    await expect(service.inspectTsdTransferItem({ ...payload, barcode: undefined, scanCode: barcode }, user))
      .resolves.toMatchObject({ state: 'SCAN_KIZ' });
    await expect(service.inspectTsdTransferItem(payload, user)).resolves.toMatchObject({ state: 'SCAN_TARGET' });
    expect(db.productMark.update).not.toHaveBeenCalled();
    expect(db.productMark.create).not.toHaveBeenCalled();
    expect(db.stockMovement.create).not.toHaveBeenCalled();
  });

  it('does not accept KIZ instead of the initial barcode', async () => {
    const { service, payload } = fixture();
    await expect(service.inspectTsdTransferItem({ ...payload, barcode: undefined }, user)).rejects.toThrow(/ШК/);
  });

  it('moves exactly one unit and the scanned mark, and does not repeat a completed request', async () => {
    const f = fixture();
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.markBox()).toBe('target');
    expect(f.db.stockMovement.create.mock.calls.map(([arg]) => arg.data.quantity)).toEqual([-1, 1]);
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.db.stockMovement.create).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing barcode', { barcode: '' }],
    ['wrong barcode', { barcode: '9999999999999' }],
    ['missing KIZ', { scanCode: barcode }],
    ['wrong KIZ format', { scanCode: 'NOT-A-DATAMATRIX-CODE-00001' }],
    ['ordinary box rather than storage box', { toBoxCode: 'FFL_OTHER' }],
    ['prefix without number', { toBoxCode: 'SBOX_' }],
  ])('rejects %s without stock writes', async (_name, change) => {
    const f = fixture();
    await expect(f.service.executeTsdTransfer({ ...f.payload, ...change }, user)).rejects.toThrow();
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
    expect(f.db.stockBalance.update).not.toHaveBeenCalled();
  });

  it('rejects storage boxes belonging to a different client or branch', async () => {
    for (const change of [{ clientId: 'other-client' }, { warehouseId: 'other-warehouse' }]) {
      const f = fixture();
      Object.assign(f.target, change);
      await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
      expect(f.db.stockBalance.update).not.toHaveBeenCalled();
    }
  });

  it('cannot move the same KIZ again using another operation key', async () => {
    const f = fixture();
    await f.service.executeTsdTransfer(f.payload, user);
    await expect(f.service.executeTsdTransfer({ ...f.payload, idempotencyKey: 'move-2' }, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([1, 1]);
  });

  // TEST: physical barcode identifies the SKU; stale mark metadata is corrected atomically.
  it('rebinds a KIZ for another SKU in the source box and moves only the scanned SKU', async () => {
    const f = fixture();
    f.mark.skuId = 'sku-other';
    await expect(f.service.inspectTsdTransferItem(f.payload, user)).resolves.toMatchObject({ state: 'SCAN_TARGET', item: { skuId: 'sku-1' } });
    expect(f.mark.skuId).toBe('sku-other');
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.mark.skuId).toBe('sku-1');
    expect(f.markBox()).toBe('target');
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.db.stockMovement.create.mock.calls.map(([arg]) => [arg.data.skuId, arg.data.quantity]))
      .toEqual([['sku-1', -1], ['sku-1', 1]]);
    expect(f.auditRows[0].payload).toMatchObject({ previousSkuId: 'sku-other', skuId: 'sku-1' });
  });

  it('allows unmarked goods after barcode, without inventing a KIZ', async () => {
    const f = fixture();
    f.sku.needsChestnyZnak = false;
    f.sku.isUnmarked = true;
    f.db.productMark.count.mockResolvedValue(0);
    await expect(f.service.inspectTsdTransferItem({ ...f.payload, barcode: undefined, scanCode: barcode }, user))
      .resolves.toMatchObject({ state: 'SCAN_TARGET' });
    await expect(f.service.executeTsdTransfer({ ...f.payload, scanCode: barcode }, user))
      .resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.db.productMark.update).not.toHaveBeenCalled();
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('accepts a missing KIZ after barcode but defers registration until movement', async () => {
    const f = fixture();
    await expect(f.service.inspectTsdTransferItem({ ...f.payload, scanCode: '010460000000000121MISSING-0001',
      bindMissingKiz: true, skuId: 'sku-1' }, user)).resolves.toMatchObject({ state: 'SCAN_TARGET' });
    expect(f.db.productMark.create).not.toHaveBeenCalled();
    expect(f.db.productMark.update).not.toHaveBeenCalled();
  });

  it('uses a custom configured prefix and rejects archived targets', async () => {
    const custom = new BoxCodePolicyService({ get: async () => ({ storageBoxPrefix: 'FFL_BOX_' }) } as never);
    await expect(custom.requireStorageBox('ffl_box_010')).resolves.toBe('FFL_BOX_010');
    await expect(custom.requireStorageBox('SBOX_010')).rejects.toThrow();
    const f = fixture();
    f.target.status = 'archived';
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/архив/);
    expect(f.db.stockBalance.update).not.toHaveBeenCalled();
  });
});

// TEST: an unregistered physical mark is not a new receipt or permission to reuse another unit.
describe('storage-box transfer with an unregistered KIZ', () => {
  const newKiz = '0104600000000001215NEW-serial01\u001d91TEST\u001d92CRYPTO';
  const prepare = () => {
    const f = fixture();
    f.payload.scanCode = newKiz;
    return f;
  };

  it('registers at the destination, audits and moves exactly one unit, idempotently', async () => {
    const f = prepare();
    await expect(f.service.inspectTsdTransferItem(f.payload, user)).resolves.toMatchObject({ state: 'SCAN_TARGET' });
    expect(f.addedMarks).toEqual([]);
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.markBox()).toBe('source');
    expect(f.addedMarks).toEqual([expect.objectContaining({ clientId: 'client-1', skuId: 'sku-1',
      boxId: 'target', value: newKiz, status: 'AVAILABLE', stockMovementId: 'movement-1' })]);
    expect(f.auditRows).toEqual([expect.objectContaining({ userId: user.id,
      action: 'TSD_STORAGE_BOX_KIZ_REGISTERED', payload: expect.objectContaining({
        physicalBoxId: 'source', targetBoxId: 'target', skuId: 'sku-1', kiz: newKiz,
        quantity: 1, deviceCode: 'TSD-01', idempotencyKey: 'move-1',
      }) })]);
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(f.db.productMark.create).toHaveBeenCalledTimes(1);
    expect(f.quantities()).toEqual([1, 1]);
    await expect(f.service.executeTsdTransfer({ ...f.payload, idempotencyKey: 'move-2' }, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([1, 1]);
  });

  it.each(['full mark capacity', 'foreign client', 'other crypto tail', 'active box task',
    'fbsTsdAssembly', 'shippedKizHistory', 'fbsWebKizStickerPrint'])(
    'does not invent a new mark when protected: %s', async fault => {
      const f = prepare();
      if (fault === 'full mark capacity') f.db.productMark.count.mockResolvedValue(2);
      if (fault === 'foreign client') Object.assign(f.mark, { clientId: 'other', value: newKiz });
      if (fault === 'other crypto tail') Object.assign(f.mark, {
        value: newKiz.replace('CRYPTO', 'PREVIOUS'), status: 'SHIPPING',
      });
      if (fault === 'active box task') f.db.fbsTsdAssembly.findFirst.mockImplementation(async ({ where }: any) => where.AND ? { id: 'task' } : null);
      if (['fbsTsdAssembly', 'shippedKizHistory', 'fbsWebKizStickerPrint'].includes(fault)) {
        f.db[fault as 'fbsTsdAssembly'].findFirst.mockResolvedValue({ id: 'used' });
      }
      await expect(f.service.inspectTsdTransferItem(f.payload, user)).rejects.toThrow();
      await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
      expect(f.db.stockMovement.create).not.toHaveBeenCalled();
      expect(f.db.productMark.create).not.toHaveBeenCalled();
      expect(f.quantities()).toEqual([2, 0]);
    });

  it('rechecks newly shipped history between inspection and execution', async () => {
    const f = prepare();
    await expect(f.service.inspectTsdTransferItem(f.payload, user)).resolves.toMatchObject({ state: 'SCAN_TARGET' });
    f.db.shippedKizHistory.findFirst.mockResolvedValue({ id: 'shipped' });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.addedMarks).toEqual([]);
  });

  it.each(['mark creation', 'audit', 'destination'])('rolls everything back after %s failure', async fault => {
    const f = prepare();
    if (fault === 'mark creation') f.db.productMark.create.mockRejectedValue(new Error('unique conflict'));
    if (fault === 'audit') f.db.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    if (fault === 'destination') f.target.clientId = 'other';
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.addedMarks).toEqual([]);
    expect(f.auditRows).toEqual([]);
    if (fault !== 'destination') expect(f.db.productMark.create).toHaveBeenCalledTimes(1);
  });

  it.each([barcode, 'FFL_SOURCE', 'PALET_SORT_001', '01' + '0'.repeat(14) + '21',
    'invalid-marking-code-that-is-long-enough'])(
    'rejects invalid scans after a valid barcode: %s', async scanCode => {
      const f = prepare();
      await expect(f.service.executeTsdTransfer({ ...f.payload, scanCode }, user)).rejects.toThrow(/КИЗ/);
      expect(f.db.productMark.create).not.toHaveBeenCalled();
      expect(f.quantities()).toEqual([2, 0]);
    });

  it('never treats a raw unknown KIZ as the initial barcode', async () => {
    const f = prepare();
    await expect(f.service.inspectTsdTransferItem({ ...f.payload, barcode: undefined }, user)).rejects.toThrow();
    expect(f.db.productMark.create).not.toHaveBeenCalled();
  });

  it.each(['scanner prefix', 'text GS', 'parenthesized AI', 'no GS crypto'])(
    'preserves raw new KIZ bytes: %s', async format => {
      const f = prepare();
      if (format === 'scanner prefix') f.payload.scanCode = `]d2${newKiz}`;
      if (format === 'text GS') f.payload.scanCode = newKiz.replace(/\u001d/g, '<GS>');
      if (format === 'parenthesized AI') f.payload.scanCode = newKiz.replace(/^01(\d{14})21/, (_all, gtin) => `(01)${gtin}(21)`);
      if (format === 'no GS crypto') f.payload.scanCode = newKiz.replace(/\u001d/g, '');
      await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
      expect(f.addedMarks[0].value).toBe(f.payload.scanCode);
      expect(f.quantities()).toEqual([1, 1]);
    });

  it('recognizes an existing same-unit crypto variant without creating a second mark', async () => {
    const f = prepare();
    f.mark.value = newKiz.replace('CRYPTO', 'OLDCRYPTO');
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.db.productMark.create).not.toHaveBeenCalled();
    expect(f.markBox()).toBe('target');
    expect(f.mark.value).toBe(newKiz.replace('CRYPTO', 'OLDCRYPTO'));
    expect(f.quantities()).toEqual([1, 1]);
  });

  it('does not bypass shipment history through an AVAILABLE same-box crypto variant', async () => {
    const f = prepare();
    f.mark.value = newKiz.replace('CRYPTO', 'OLDCRYPTO');
    f.db.shippedKizHistory.findFirst.mockResolvedValue({ id: 'previous-shipment' });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/отгруз/);
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.db.productMark.create).not.toHaveBeenCalled();
  });

  it('does not identify a longer serial by its matching prefix', async () => {
    const f = prepare();
    f.payload.scanCode = '010460000000000121PREFIX';
    f.mark.value = '010460000000000121PREFIX-OTHER';
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/серийный/);
    expect(f.quantities()).toEqual([2, 0]);
  });

  it('rejects a simulated SQL LIKE wildcard match with a different serial', async () => {
    const f = prepare();
    f.payload.scanCode = '010460000000000121SERIAL_%';
    const find = f.db.productMark.findFirst.getMockImplementation()!;
    f.db.productMark.findFirst.mockImplementation(async (args: any) => args.where.OR
      ? { ...f.mark, value: '010460000000000121SERIAL_XX', boxId: 'source' } : find(args));
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/серийный/);
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.db.productMark.create).not.toHaveBeenCalled();
  });

  it('does not register after another worker emptied the source', async () => {
    const f = prepare();
    await f.service.inspectTsdTransferItem(f.payload, user);
    const find = f.db.box.findUnique.getMockImplementation()!;
    f.db.box.findUnique.mockImplementation(async (args: any) => {
      const box = await find(args);
      return box?.id === 'source' ? { ...box, balances: [] } : box;
    });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/нет доступного/);
    expect(f.db.productMark.create).not.toHaveBeenCalled();
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  });

  // TEST: production now archives completed FBS attempts outside the live task table.
  it.each(['true', 'read-only', 'false'])('protects archived FBS KIZ when repeats are %s', async mode => {
    vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED', mode);
    try {
      const f = prepare();
      const findFirst = vi.fn(async () => ({ id: 'archived-attempt' }));
      (f.db as any).fbsAssemblyAttemptHistory = { findFirst };
      await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/сборк|отгруз/);
      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(f.quantities()).toEqual([2, 0]);
      expect(f.addedMarks).toEqual([]);
    } finally { vi.unstubAllEnvs(); }
  });

  it.each(['missing delegate', 'unavailable database'])('fails closed if enabled history is %s', async fault => {
    vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED', 'true');
    try {
      const f = prepare();
      if (fault === 'unavailable database') (f.db as any).fbsAssemblyAttemptHistory = {
        findFirst: vi.fn().mockRejectedValue(new Error('history unavailable')),
      };
      await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
      expect(f.quantities()).toEqual([2, 0]);
      expect(f.db.productMark.create).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it('does not require repeat-assembly schema on installations without that feature', async () => {
    vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED', 'false');
    try {
      const f = prepare();
      await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
      expect(f.quantities()).toEqual([1, 1]);
    } finally { vi.unstubAllEnvs(); }
  });
});

// TEST: existing Android clients send the SKU returned after barcode, then bindMissingKiz.
describe('TSD transfer physical barcode/KIZ rebinding', () => {
  const bindPayload = (f: ReturnType<typeof fixture>) => ({ ...f.payload,
    transferMode: undefined, skuId: 'sku-1', bindMissingKiz: true });

  it('corrects only the existing mark, audits old/new SKU, then allows ordinary transfer', async () => {
    const f = fixture(); f.mark.skuId = 'wrong-sku'; f.target.code = 'FFL_TARGET';
    await expect(f.service.inspectTsdTransferItem({ fromBoxCode: 'FFL_SOURCE', scanCode: barcode }, user))
      .resolves.toMatchObject({ state: 'SCAN_KIZ', item: { skuId: 'sku-1' } });
    await expect(f.service.inspectTsdTransferItem(bindPayload(f), user))
      .resolves.toMatchObject({ state: 'SCAN_ITEM', item: { skuId: 'sku-1', scanType: 'KIZ' } });
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.mark.skuId).toBe('sku-1');
    expect(f.db.productMark.create).not.toHaveBeenCalled();
    expect(f.auditRows[0]).toMatchObject({ userId: user.id,
      action: 'TSD_TRANSFER_KIZ_REBIND', payload: { previousSkuId: 'wrong-sku', skuId: 'sku-1' } });
    await f.service.inspectTsdTransferItem(bindPayload(f), user);
    expect(f.auditRows).toHaveLength(1);
    await expect(f.service.executeTsdTransfer({ ...f.payload, transferMode: undefined, toBoxCode: 'FFL_TARGET' }, user))
      .resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.markBox()).toBe('target');
  });

  it.each(['fbsTsdAssembly', 'shippedKizHistory', 'fbsWebKizStickerPrint'] as const)(
    'never rebinds a wrong-SKU mark referenced by %s, even in the same box', async model => {
      const f = fixture(); f.mark.skuId = 'wrong-sku';
      f.db[model].findFirst.mockResolvedValue({ id: 'protected' });
      await expect(f.service.inspectTsdTransferItem(bindPayload(f), user)).rejects.toThrow();
      expect(f.mark.skuId).toBe('wrong-sku');
      expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
    });

  // TEST: ordinary Android transfer submits a batch after the barcode/KIZ scans.
  it('moves the rebound mark through the Android batch endpoint exactly once', async () => {
    const f = fixture(); f.mark.skuId = 'wrong-sku'; f.target.code = 'FFL_TARGET';
    await f.service.inspectTsdTransferItem(bindPayload(f), user);
    const batch = { fromBoxCode: 'FFL_SOURCE', toBoxCode: 'FFL_TARGET', scanCodes: [kiz], idempotencyKey: 'batch-1' };
    await expect(f.service.executeTsdTransferBatch(batch, user)).resolves.toMatchObject({ status: 'APPLIED', movedQuantity: 1 });
    await expect(f.service.executeTsdTransferBatch(batch, user)).resolves.toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(f.mark.skuId).toBe('sku-1');
    expect(f.markBox()).toBe('target');
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.db.stockMovement.create).toHaveBeenCalledTimes(2);
  });

  it.each(['missing SKU', 'unknown SKU', 'full source', 'other branch', 'old stock'])(
    'does not rebind when evidence is insufficient: %s', async fault => {
      const f = fixture(fault === 'other branch' || fault === 'old stock' ? 'old' : 'source');
      f.mark.skuId = 'wrong-sku';
      const payload = bindPayload(f);
      if (fault === 'missing SKU') payload.skuId = '';
      if (fault === 'unknown SKU') payload.skuId = 'unknown';
      if (fault === 'full source') f.db.productMark.count.mockResolvedValue(2);
      if (fault === 'other branch') f.oldBox.warehouseId = 'other';
      if (fault === 'old stock') f.oldBalances.push({ quantity: 1 });
      await expect(f.service.inspectTsdTransferItem(payload, user)).rejects.toThrow();
      expect(f.mark.skuId).toBe('wrong-sku');
      expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
      expect(f.db.stockMovement.create).not.toHaveBeenCalled();
    });

  it.each(['RESERVED', 'SHIPPING'])('does not revive a %s wrong-SKU mark', async status => {
    const f = fixture(); f.mark.skuId = 'wrong-sku'; f.mark.status = status;
    await expect(f.service.inspectTsdTransferItem(bindPayload(f), user)).rejects.toThrow();
    expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
  });

  it.each(['audit', 'race'])('rolls back legacy rebinding on %s failure', async failure => {
    const f = fixture(); f.mark.skuId = 'wrong-sku';
    if (failure === 'audit') f.db.auditLog.create.mockRejectedValue(new Error('audit failed'));
    else f.db.productMark.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.service.inspectTsdTransferItem(bindPayload(f), user)).rejects.toThrow();
    expect(f.db.productMark.updateMany).toHaveBeenCalledTimes(1);
    expect(f.mark.skuId).toBe('wrong-sku');
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.auditRows).toEqual([]);
  });

  it('rolls back SKU, stock and location together if storage-box audit fails', async () => {
    const f = fixture(); f.mark.skuId = 'wrong-sku';
    f.db.auditLog.create.mockRejectedValue(new Error('audit failed'));
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow('audit failed');
    expect(f.mark.skuId).toBe('wrong-sku');
    expect(f.markBox()).toBe('source');
    expect(f.quantities()).toEqual([2, 0]);
  });

  it('checks active tasks for both the previous SKU and physically scanned SKU', async () => {
    const f = fixture(); f.mark.skuId = 'wrong-sku';
    await f.service.inspectTsdTransferItem(f.payload, user);
    expect(f.db.fbsTsdAssembly.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      AND: expect.arrayContaining([{ OR: [{ skuId: { in: ['wrong-sku', 'sku-1'] } },
        { sourceSkuId: { in: ['wrong-sku', 'sku-1'] } }] }]),
    }) }));
  });
});

// TEST: inventory can correct quantities while a known KIZ remains on an empty old box.
describe('storage-box stale KIZ reconciliation', () => {
  it('accepts a known KIZ from an empty old box without writes during inspection', async () => {
    const f = fixture('old');
    await expect(f.service.inspectTsdTransferItem(f.payload, user)).resolves.toMatchObject({ state: 'SCAN_TARGET' });
    expect(f.markBox()).toBe('old');
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
    expect(f.db.auditLog.create).not.toHaveBeenCalled();
  });

  it('reconciles the mark and moves one physical unit atomically, with an audit and retry protection', async () => {
    const f = fixture('old');
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.oldBalances).toEqual([]);
    expect(f.markBox()).toBe('target');
    expect(f.db.productMark.create).not.toHaveBeenCalled();
    expect(f.auditRows).toEqual([expect.objectContaining({
      userId: user.id, entityId: 'mark-1', action: 'TSD_STORAGE_BOX_KIZ_RECONCILIATION',
      payload: expect.objectContaining({ previousBoxId: 'old', physicalBoxId: 'source',
        targetBoxId: 'target', kiz, deviceCode: 'TSD-01', idempotencyKey: 'move-1' }),
    })]);
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.auditRows).toHaveLength(1);
  });

  it.each(['AVAILABLE', 'RESERVED', 'SHIPPING'])('rejects an old box with %s stock', async status => {
    const f = fixture('old'); f.oldBalances.push({ quantity: 1, status });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/старом коробе/);
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  });

  it.each(['RESERVED', 'SHIPPING'])('rejects a %s mark even when source quantity is available', async status => {
    const f = fixture('old'); f.mark.status = status;
    await expect(f.service.inspectTsdTransferItem(f.payload, user)).rejects.toThrow(/недоступен/);
  });

  it.each([{ clientId: 'other' }, { warehouseId: 'other' }, { warehouseId: null }])(
    'does not reconcile across client/branch boundaries: %j', async change => {
      const f = fixture('old'); Object.assign(f.oldBox, change);
      await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/клиент|филиал/);
      expect(f.quantities()).toEqual([2, 0]);
    });

  it('accepts a stale SKU from an empty old box, but never replaces another mark to make room', async () => {
    const wrong = fixture('old'); wrong.mark.skuId = 'other';
    await expect(wrong.service.executeTsdTransfer(wrong.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
    expect(wrong.mark.skuId).toBe('sku-1');
    const full = fixture('old'); full.db.productMark.count.mockResolvedValue(2);
    await expect(full.service.executeTsdTransfer(full.payload, user)).rejects.toThrow(/привязаны/);
    expect(full.db.productMark.updateMany).not.toHaveBeenCalled();
  });

  it.each(['fbsTsdAssembly', 'shippedKizHistory', 'fbsWebKizStickerPrint'] as const)(
    'rejects a mark already referenced by %s', async model => {
      const f = fixture('old'); f.db[model].findFirst.mockResolvedValue({ id: 'used', orderId: '123' });
      await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/заказ|отгруж|этикет/);
      expect(f.db.stockMovement.create).not.toHaveBeenCalled();
    });

  it('rejects a box/SKU task even if its KIZ has not been scanned yet', async () => {
    const f = fixture('old');
    f.db.fbsTsdAssembly.findFirst.mockImplementation(async ({ where }: any) => where.kiz ? null : { id: 'reserved' });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/сборк/);
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  });

  it('rechecks protection after inspection, before any stock movement', async () => {
    const f = fixture('old');
    await f.service.inspectTsdTransferItem(f.payload, user);
    f.db.shippedKizHistory.findFirst.mockResolvedValue({ id: 'shipped-between-scans' });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([2, 0]);
  });

  it.each(['audit failure', 'concurrent mark change'])('rolls back the complete operation on %s', async fault => {
    const f = fixture('old');
    if (fault === 'audit failure') f.db.auditLog.create.mockRejectedValue(new Error('audit failure'));
    else f.db.productMark.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.markBox()).toBe('old');
    expect(f.auditRows).toEqual([]);
    expect(f.db.productMark.updateMany).toHaveBeenCalledTimes(1);
  });

  it('leaves legacy inspection strict and unchanged', async () => {
    const f = fixture('old');
    await expect(f.service.inspectTsdTransferItem({ ...f.payload, transferMode: undefined }, user)).rejects.toThrow();
    expect(f.db.fbsTsdAssembly.findFirst).not.toHaveBeenCalled();
    expect(f.markBox()).toBe('old');
  });

  // TEST: GS/crypto bytes are retained; existing order ownership is checked by identity.
  it('protects a KIZ whose order record has a different crypto tail', async () => {
    const identity = '0104600000000001215TEST-serial1';
    const f = fixture('old', `${identity}\u001d91TEST\u001d92CRYPTO`);
    f.db.fbsTsdAssembly.findFirst.mockImplementation(async ({ where }: any) =>
      where.kiz?.startsWith === identity ? { id: 'existing-order' } : null);
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/заказ/);
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  });

  it('preserves the full KIZ including GS separators in the reconciliation audit', async () => {
    const fullKiz = '0104600000000001215TEST-serial1\u001d91TEST\u001d92CRYPTO';
    const f = fixture('old', fullKiz);
    await f.service.executeTsdTransfer(f.payload, user);
    expect(f.auditRows[0].payload.kiz).toBe(fullKiz);
    expect(f.mark.value).toBe(fullKiz);
  });

  it('does not accept a mark owned by another client or guess a missing old box', async () => {
    const foreign = fixture('old'); foreign.mark.clientId = 'other-client';
    await expect(foreign.service.inspectTsdTransferItem(foreign.payload, user)).rejects.toThrow(/клиент/);
    const missing = fixture('unknown-box');
    await expect(missing.service.inspectTsdTransferItem(missing.payload, user)).rejects.toThrow(/клиент|филиал/);
    expect(missing.db.productMark.create).not.toHaveBeenCalled();
  });

  it('does not bypass source client access', async () => {
    const f = fixture('old'); f.scopes.requireClientAccess.mockImplementation(() => { throw new Error('access denied'); });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow('access denied');
    expect(f.db.productMark.findFirst).not.toHaveBeenCalled();
    expect(f.quantities()).toEqual([2, 0]);
  });

  it('keeps the old association when destination validation fails', async () => {
    const f = fixture('old'); f.target.clientId = 'other-client';
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
    expect(f.markBox()).toBe('old');
    expect(f.auditRows).toEqual([]);
    expect(f.quantities()).toEqual([2, 0]);
  });
});

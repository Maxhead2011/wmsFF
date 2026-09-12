import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountFbsOrderByWb } from '../src/modules/marketplace-connections/fbs-wb-accounting';
import { inspectWbKizShipment } from '../src/modules/marketplace-connections/fbs-wb-kiz-shipment';

function fixture() {
  for (const flag of ['WMS_FBS_NO_STOCK_TRANSFER_ENABLED', 'WMS_FBS_RESHIPMENT_ENABLED', 'WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED']) vi.stubEnv(flag, 'true');
  const date = new Date('2026-09-12T08:00:00Z');
  const task: any = { id: 'task', clientId: 'client', requestId: 'request', requestItemId: 'item', connectionId: 'cabinet',
    marketplace: 'WILDBERRIES', orderId: '5702368259', supplyId: 'supply', skuId: 'sku', status: 'COMPLETED', itemCount: 1,
    kiz: '010460000000000021UNIT-A', barcode: '2047945706831', barcodes: ['2047945706831'], boxId: null,
    boxCode: null, sourceBoxPending: true, completedAt: date, updatedAt: date };
  const link: any = { id: 'link', clientId: 'client', requestId: 'request', syncStatus: 'ACTIVE', updatedAt: date };
  const request: any = { id: 'request', number: 774, title: 'FBS', clientId: 'client', client: { name: 'Client' }, warehouseId: 'warehouse', status: 'IN_WORK' };
  const sku: any = { id: 'sku', clientId: 'client', internalSku: 'SKU', name: 'Suit', article: 'A', size: '44', color: 'Brown', barcodes: [{ value: task.barcode }] };
  const db: any = {
    $queryRaw: vi.fn(async () => []),
    fbsTsdAssembly: { findUnique: vi.fn(async () => task), findFirst: vi.fn(async () => null), updateMany: vi.fn(async ({ data }) => { Object.assign(task, data); return { count: 1 }; }) },
    fbsOrderRequestLink: { findUnique: vi.fn(async () => link), updateMany: vi.fn(async ({ data }) => { Object.assign(link, data); return { count: 1 }; }) },
    clientRequest: { findUnique: vi.fn(async () => request) }, sku: { findFirst: vi.fn(async () => sku) },
    productMark: { findUnique: vi.fn(async () => null), create: vi.fn(async ({ data }) => ({ id: 'mark', ...data })), updateMany: vi.fn(async () => ({ count: 1 })) },
    box: { findFirst: vi.fn(async () => null) },
    shippedKizHistory: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }) => data) },
    stockBalance: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })), deleteMany: vi.fn() },
    stockMovement: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), create: vi.fn(async ({ data }) => ({ id: 'movement', ...data })) },
    auditLog: { create: vi.fn() }, clientRequestEvent: { create: vi.fn() },
  };
  db.$transaction = vi.fn(async fn => fn(db));
  const user: any = { id: 'manager', name: 'Manager', roleCodes: ['MANAGER'], permissionCodes: ['client-requests:write', 'stock:write'], activeWarehouseId: 'warehouse', writableWarehouseIds: ['warehouse'] };
  const read = vi.fn(async () => ({ supplierStatus: 'complete', wbStatus: 'sorted', isTransferable: false }));
  const run = () => accountFbsOrderByWb(db, { requireClientAccess: vi.fn() } as any, 'request', 'task', { comment: 'Отгрузка подтверждена WB' }, user, read);
  return { task, link, request, sku, db, read, run, user };
}
afterEach(() => vi.unstubAllEnvs());

// TEST: source lookup never substitutes a suggested box or another customer's stock.
describe('WB shipment source evidence', () => {
  it('uses no box when only a suggested reservation exists', async () => {
    const f = fixture(); f.task.reservedBoxId = 'suggested'; f.task.reservedBoxCode = 'SUGGESTED';
    expect(await inspectWbKizShipment(f.db, f.task, 'warehouse')).toMatchObject({ source: null, sourceBoxCode: 'Без короба' });
    expect(f.db.box.findFirst).not.toHaveBeenCalled();
  });
  it('uses the exact KIZ source box when it exists in this client and warehouse', async () => {
    const f = fixture();
    f.db.productMark.findUnique.mockResolvedValue({ id: 'mark', clientId: 'client', skuId: 'sku', value: f.task.kiz, boxId: 'source', status: 'AVAILABLE', updatedAt: new Date('2026-09-11') });
    f.db.box.findFirst.mockResolvedValue({ id: 'source', code: 'SOURCE', clientId: 'client', warehouseId: 'warehouse', palletId: null });
    expect(await inspectWbKizShipment(f.db, f.task, 'warehouse')).toMatchObject({ source: { id: 'source' }, sourceBoxCode: 'SOURCE' });
  });
  it.each(['clientId', 'warehouseId'])('rejects a source with a different %s', async field => {
    const f = fixture(); f.task.boxId = 'source';
    f.db.box.findFirst.mockResolvedValue({ id: 'source', code: 'SOURCE', clientId: 'client', warehouseId: 'warehouse', [field]: 'other' });
    await expect(inspectWbKizShipment(f.db, f.task, 'warehouse')).rejects.toThrow('другого клиента');
  });
  it('does not reinterpret a mismatched source as no box', async () => {
    const f = fixture(); f.task.boxId = 'scanned';
    f.db.productMark.findUnique.mockResolvedValue({ clientId: 'client', skuId: 'sku', value: f.task.kiz, boxId: 'different', updatedAt: new Date('2026-09-11') });
    await expect(inspectWbKizShipment(f.db, f.task, 'warehouse')).rejects.toThrow('не совпадают');
  });
  it('preserves a KIZ received again after the old order was collected', async () => {
    const f = fixture();
    f.db.productMark.findUnique.mockResolvedValue({ clientId: 'client', skuId: 'sku', value: f.task.kiz, boxId: 'return', updatedAt: new Date('2026-09-13') });
    await expect(inspectWbKizShipment(f.db, f.task, 'warehouse')).rejects.toThrow('повторная приёмка');
  });
});

describe('WB shipment with an exact KIZ/barcode pair', () => {
  // TEST: request 783 is PACKED; an exact confirmed pair can be shipped once without reopening it.
  it('ships an exact pair from a packed request and replays without another deduction', async () => {
    const f = fixture(); f.request.number = 783; f.request.status = 'PACKED';
    await expect(f.run()).resolves.toMatchObject({ shipped: true });
    await expect(f.run()).resolves.toMatchObject({ shipped: true });
    expect(f.request.status).toBe('PACKED');
    expect(f.db.shippedKizHistory.create).toHaveBeenCalledTimes(1);
    expect(f.db.stockMovement.create.mock.calls.filter(([arg]) => arg.data.type === 'SHIP')).toHaveLength(1);
    expect(f.read).toHaveBeenCalledTimes(1);
  });
  // TEST: the packed exception cannot reopen a request or repeat a request-wide shipment.
  it.each(['no-pair', 'closed', 'previous-shipment', 'closed-during-check'])('keeps %s blocked for packed accounting', async scenario => {
    const f = fixture(); f.request.status = 'PACKED';
    if (scenario === 'no-pair') { f.task.kiz = null; f.task.barcode = null; }
    if (scenario === 'closed') f.request.status = 'DONE';
    if (scenario === 'previous-shipment') f.db.stockMovement.findMany.mockResolvedValue([{ idempotencyKey: 'whole-request-shipment' }]);
    if (scenario === 'closed-during-check') f.read.mockImplementation(async () => {
      f.request.status = 'DONE'; return { supplierStatus: 'complete', wbStatus: 'sorted', isTransferable: false };
    });
    await expect(f.run()).rejects.toThrow();
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
    expect(f.db.shippedKizHistory.create).not.toHaveBeenCalled();
    if (scenario === 'previous-shipment') expect(f.db.stockMovement.findMany).toHaveBeenCalled();
    if (scenario === 'closed-during-check') expect(f.read).toHaveBeenCalledTimes(1);
  });
  // TEST: previously a linked KIZ was rejected, even when WB confirmed shipment.
  it('records the exact pair and explicitly uses no box when no source mapping exists', async () => {
    const f = fixture();
    await f.run();
    expect(f.db.shippedKizHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      assemblyId: 'task', requestId: 'request', orderId: '5702368259', kiz: f.task.kiz,
      barcode: '2047945706831', sourceBoxCode: 'Без короба', warehouseId: 'warehouse',
    }) });
    expect(f.task.sourceBoxPending).toBe(false);
    expect(f.db.stockBalance.updateMany).not.toHaveBeenCalled();
    expect(f.db.stockMovement.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'SHIP', quantity: -1, idempotencyKey: 'fbs-wb-shipment:task', boxId: null }) });
    expect(f.db.productMark.create).toHaveBeenCalledWith({ data: expect.objectContaining({ value: f.task.kiz, status: 'SHIPPING', boxId: null }) });
    await f.run();
    expect(f.db.shippedKizHistory.create).toHaveBeenCalledTimes(1);
    expect(f.read).toHaveBeenCalledTimes(1);
  });
  it('deducts one unit only from the exact KIZ source balance', async () => {
    const f = fixture();
    f.db.productMark.findUnique.mockResolvedValue({ id: 'mark', clientId: 'client', skuId: 'sku', value: f.task.kiz,
      boxId: 'source', status: 'AVAILABLE', updatedAt: new Date('2026-09-11') });
    f.db.box.findFirst.mockResolvedValue({ id: 'source', code: 'SOURCE', clientId: 'client', warehouseId: 'warehouse', palletId: null });
    const balance = { id: 'exact', clientId: 'client', skuId: 'sku', warehouseId: 'warehouse', boxId: 'source', palletId: null, status: 'AVAILABLE', quantity: 2, updatedAt: new Date('2026-09-11') };
    f.db.stockBalance.findMany.mockResolvedValue([{ ...balance, id: 'other', boxId: 'other' }, balance]);
    await f.run();
    expect(f.db.stockBalance.updateMany).toHaveBeenCalledWith({ where: { id: 'exact', quantity: 2, updatedAt: balance.updatedAt }, data: { quantity: { decrement: 1 } } });
    expect(f.db.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(f.db.stockMovement.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'SHIP', quantity: -1, boxId: 'source', status: 'AVAILABLE' }) });
    expect(f.db.productMark.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: 'mark' }), data: expect.objectContaining({ status: 'SHIPPING', boxId: null }) });
  });
  it.each(['PACKING', 'SHIPPING'])('consumes a proven prior pick from %s without deducting AVAILABLE again', async status => {
    const f = fixture();
    f.db.productMark.findUnique.mockResolvedValue({ id: 'mark', clientId: 'client', skuId: 'sku', value: f.task.kiz, boxId: null, status: 'PACKING', updatedAt: new Date('2026-09-11') });
    f.db.stockMovement.findMany.mockImplementation(async ({ where }: any) => where.idempotencyKey ? [{ quantity: 1, status: 'PACKING', boxId: null, palletId: null }] : []);
    f.db.stockBalance.findMany.mockResolvedValue([{ id: 'picked', clientId: 'client', skuId: 'sku', warehouseId: 'warehouse', boxId: null, palletId: null, status, quantity: 1 }]);
    await f.run();
    expect(f.db.stockBalance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ['PACKING', 'SHIPPING'] } }) }));
    expect(f.db.stockMovement.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'SHIP', status, quantity: -1 }) });
  });
  it('requires warehouse write permission before WB or stock changes', async () => {
    const f = fixture(); f.user.permissionCodes = ['client-requests:write'];
    await expect(f.run()).rejects.toThrow('права на складские операции');
    expect(f.read).not.toHaveBeenCalled(); expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it('honors the inventory lock before reading WB and changing stock', async () => {
    const f = fixture();
    await expect(accountFbsOrderByWb(f.db, { requireClientAccess: vi.fn() } as any, 'request', 'task', { comment: 'Проверено' }, f.user, f.read,
      async () => { throw new Error('Inventory locked'); })).rejects.toThrow('Inventory locked');
    expect(f.read).not.toHaveBeenCalled(); expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it('stops when the exact balance changes concurrently', async () => {
    const f = fixture(); f.task.boxId = 'source';
    f.db.productMark.findUnique.mockResolvedValue({ id: 'mark', clientId: 'client', skuId: 'sku', value: f.task.kiz, boxId: 'source', status: 'AVAILABLE', updatedAt: new Date('2026-09-11') });
    f.db.box.findFirst.mockResolvedValue({ id: 'source', code: 'SOURCE', clientId: 'client', warehouseId: 'warehouse', palletId: null });
    f.db.stockBalance.findMany.mockResolvedValue([{ id: 'balance', clientId: 'client', skuId: 'sku', warehouseId: 'warehouse', boxId: 'source', palletId: null, status: 'AVAILABLE', quantity: 1 }]);
    f.db.stockBalance.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.run()).rejects.toThrow('Остаток изменился');
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
    expect(f.db.shippedKizHistory.create).not.toHaveBeenCalled();
  });
  it('does not invent a barcode when only a KIZ is linked', async () => {
    const f = fixture(); f.task.barcode = null;
    await expect(f.run()).rejects.toThrow();
    expect(f.db.shippedKizHistory.create).not.toHaveBeenCalled();
  });
  it('rejects a pair belonging to a different SKU', async () => {
    const f = fixture(); f.db.productMark.findUnique.mockResolvedValue({ id: 'mark', clientId: 'client', skuId: 'different', value: f.task.kiz, updatedAt: new Date('2026-09-11'), status: 'AVAILABLE' });
    await expect(f.run()).rejects.toThrow();
    expect(f.db.shippedKizHistory.create).not.toHaveBeenCalled();
  });
  it('does not record a shipment when WB no longer confirms it', async () => {
    const f = fixture(); f.read.mockResolvedValue({ supplierStatus: 'complete', wbStatus: 'canceled_by_client', isTransferable: false });
    await expect(f.run()).rejects.toThrow();
    expect(f.db.shippedKizHistory.create).not.toHaveBeenCalled();
  });
});

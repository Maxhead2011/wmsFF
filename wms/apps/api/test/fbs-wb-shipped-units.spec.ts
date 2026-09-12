import { describe, expect, it, vi } from 'vitest';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
import { readWbShippedUnits } from '../src/modules/stock/fbs-wb-shipped-units';

function fixture(total = 2, status = 'IN_WORK') {
  const date = new Date('2026-09-12');
  const item = { id: 'item', skuId: 'sku', barcode: 'barcode', quantity: total };
  const request: any = { id: 'request', clientId: 'client', warehouseId: 'warehouse', number: 774,
    type: 'OUTBOUND', status, title: 'FBS', client: { name: 'Client' }, items: [item] };
  const task: any = { id: 'task', requestId: 'request', requestItemId: 'item', clientId: 'client', skuId: 'sku',
    orderId: '100', kiz: 'KIZ', barcode: 'barcode', boxId: null, status: 'WB_ACCOUNTED', itemCount: 1 };
  const history: any = { assemblyId: 'task', requestId: 'request', clientId: 'client', warehouseId: 'warehouse',
    skuId: 'sku', kiz: 'KIZ', barcode: 'barcode', orderId: '100', sourceBoxCode: 'Без короба', shippedAt: date };
  const shipped: any = { id: 'wb-shipment', clientId: 'client', warehouseId: 'warehouse', skuId: 'sku',
    sourceDocument: 'request', type: 'SHIP', status: 'SHIPPING', quantity: -1, idempotencyKey: 'fbs-wb-shipment:task' };
  const balance: any = { id: 'remaining-balance', balanceKey: 'remaining', clientId: 'client', warehouseId: 'warehouse', skuId: 'sku',
    boxId: null, palletId: null, box: null, status: status === 'PACKED' ? 'SHIPPING' : 'AVAILABLE', quantity: total - 1, updatedAt: date };
  const db: any = {
    clientRequest: { findUnique: vi.fn(async () => request), update: vi.fn(async ({ data }) => Object.assign(request, data)) },
    client: { findUnique: vi.fn(async () => ({ storesWithoutBoxes: true })) },
    fbsTsdAssembly: { findMany: vi.fn(async ({ where }) => where.status === 'COMPLETED' ? [] : [task]) },
    shippedKizHistory: { findMany: vi.fn(async () => [history]) },
    stockMovement: { findMany: vi.fn(async () => [shipped]),
      findFirst: vi.fn(async ({ where }) => JSON.stringify(where).includes('fbs-wb-shipment:') ? null : shipped), create: vi.fn(async ({ data }) => data) },
    stockBalance: { findMany: vi.fn(async () => balance.quantity ? [balance] : []),
      update: vi.fn(async ({ data }) => { balance.quantity -= data.quantity.decrement; return balance; }), delete: vi.fn() },
    sku: { findFirst: vi.fn(async () => ({ id: 'sku', internalSku: 'SKU', weightGrams: 100 })) },
    clientRequestBoxSelection: { findMany: vi.fn(async () => []) },
    clientRequestPackage: { deleteMany: vi.fn(), create: vi.fn(async () => ({ id: 'package', items: [] })) },
    clientRequestEvent: { findFirst: vi.fn(async () => null), create: vi.fn() },
  };
  const user: any = { id: 'manager', name: 'Manager', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'],
    activeWarehouseId: 'warehouse', warehouseIds: ['warehouse'], writableWarehouseIds: ['warehouse'] };
  const service: any = new StockOperationsService({ $transaction: (fn: any) => fn(db) } as any,
    { requireClientAccess: vi.fn() } as any, { balanceKey: vi.fn() } as any);
  return { db, request, task, history, shipped, balance, user, service };
}

describe('already shipped WB units during WMS completion', () => {
  // TEST: before this fix, one SHIP row could close the whole request without shipping its remainder.
  it.each([1, 2])('manual close with %s total units consumes only the remainder and retains the full composition', async total => {
    const f = fixture(total);
    const result = await f.service.shipClientRequestFromCurrentStock({ requestId: 'request', comment: 'Сдано', boxes: 1, pallets: 0, packedUnits: total }, f.user);
    expect(result.status).toBe('APPLIED');
    expect(result.shippedLines).toMatchObject([{ itemId: 'item', requestedQuantity: total, shippedQuantity: total }]);
    expect(f.db.stockBalance.update).toHaveBeenCalledTimes(total - 1);
    expect(f.db.stockMovement.create).toHaveBeenCalledTimes(total - 1);
    if (total === 2) expect(f.db.stockMovement.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'SHIP', quantity: -1 }) });
    expect(f.request.items[0].quantity).toBe(total);
    expect(f.request.status).toBe('DONE');
  });
  it('normal shipment consumes only the remaining packed unit', async () => {
    const f = fixture(2, 'PACKED');
    const result = await f.service.shipClientRequest({ requestId: 'request' }, f.user);
    expect(result.status).toBe('APPLIED');
    expect(f.db.stockBalance.update).toHaveBeenCalledTimes(1);
    expect(f.db.stockMovement.create).toHaveBeenCalledWith({ data: expect.objectContaining({ quantity: -1, type: 'SHIP' }) });
  });
  it('status movement skips an already shipped allocation', async () => {
    const f = fixture(1);
    const plan = await f.service.planWithWbShipments(f.db, f.request, [], 'warehouse', vi.fn());
    await f.service.applyStatusMove(f.db, { request: f.request, plan, baseKey: 'pack', sourceStatus: 'PACKING', targetStatus: 'SHIPPING', movementType: 'PACK' });
    expect(f.db.stockBalance.update).not.toHaveBeenCalled();
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  });
  it.each(['warehouseId', 'kiz', 'barcode', 'orderId'])('blocks a mismatched shipment-history %s', async field => {
    const f = fixture(); f.history[field] = 'other';
    await expect(readWbShippedUnits(f.db, f.request, 'warehouse')).rejects.toThrow('Повторное списание остановлено');
    expect(f.db.stockBalance.update).not.toHaveBeenCalled();
  });
});

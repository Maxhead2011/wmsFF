import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/modules/warehouse/receipt-channel-policy', () => ({ receiptPublicationPolicy: async () => ({ blocked: ['pending-receipt'], credit: new Map() }) }));
import { readSharedStock } from '../src/modules/marketplace-connections/multishop-stock-reader';
function fixture() {
  const db: any = {
    client: { findUniqueOrThrow: vi.fn(async () => ({ storesWithoutBoxes: false, stockBalanceMode: 'BOXES' })) },
    sku: { findMany: vi.fn(async () => ['a', 'b'].map(id => ({ id, barcodes: [{ value: id }] }))) },
    clientRequest: { findMany: vi.fn(async () => [{ id: 'r', warehouseId: 'msk', items: [{ skuId: 'a', quantity: 5 }] }]) },
    stockBalance: { findMany: vi.fn(async () => [{ skuId: 'a', quantity: 20 }, { skuId: 'b', quantity: 20 }]) },
    stockMovement: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
    fbsOrderRequestLink: { findMany: vi.fn(async () => [{ marketplace: 'OZON', connectionId: 'shop', orderId: 'order', requestId: 'r' }]) },
    fbsTsdAssembly: { findMany: vi.fn(async () => [{ id: 'task', marketplace: 'OZON', connectionId: 'shop', orderId: 'order', requestId: 'r', skuId: 'a', itemCount: 5 }]) },
    $queryRaw: vi.fn(async () => []),
  };
  db.$transaction = vi.fn(async (action: any) => action(db));
  return db;
}
const orders = [{ marketplace: 'OZON' as const, connectionId: 'shop', orderId: 'order', requestId: null, skuId: 'a', quantity: 2 }, { marketplace: 'OZON' as const, connectionId: 'shop', orderId: 'order', requestId: null, skuId: 'b', quantity: 3 }];
describe('shared stock database reader', () => {
  // TEST: a legacy first-product request is normalized without changing business rows.
  it('replaces the Ozon legacy summary with the complete posting composition', async () => {
    const db = fixture(), result = await readSharedStock(db, 'client', 'msk', ['a', 'b'], orders);
    expect(result.quantities.get('a')?.free).toBe(18);
    expect(result.quantities.get('b')?.free).toBe(17);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'RepeatableRead' }));
    expect(db.stockBalance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: 'client', warehouseId: 'msk', status: 'AVAILABLE', boxId: { not: null, notIn: ['pending-receipt'] } }) }));
  });
  it('does not expand a request again when Ozon lines have already been persisted', async () => {
    const db = fixture(); db.$queryRaw.mockResolvedValue([{ assemblyId: 'task' }]);
    db.clientRequest.findMany.mockResolvedValue([{ id: 'r', warehouseId: 'msk', items: [{ skuId: 'a', quantity: 2 }, { skuId: 'b', quantity: 3 }] }]);
    const result = await readSharedStock(db, 'client', 'msk', ['a', 'b'], orders);
    expect(result.quantities.get('a')?.reserved).toBe(2); expect(result.quantities.get('b')?.reserved).toBe(3);
  });
  it('subtracts actual movement from both request and order reserve once', async () => {
    const db = fixture(); db.stockBalance.findMany.mockResolvedValue([{ skuId: 'a', quantity: 19 }, { skuId: 'b', quantity: 20 }]);
    db.stockMovement.groupBy.mockResolvedValue([{ sourceDocument: 'r', skuId: 'a', _sum: { quantity: -1 } }]);
    const result = await readSharedStock(db, 'client', 'msk', ['a', 'b'], orders);
    expect(result.quantities.get('a')).toEqual({ available: 19, reserved: 1, free: 18 });
  });
  it('rejects ambiguous warehouse or product ownership', async () => {
    const db = fixture();
    await expect(readSharedStock(db, 'client', 'msk', ['foreign'], orders)).rejects.toThrow('другого клиента');
    db.clientRequest.findMany.mockResolvedValue([{ id: 'r', warehouseId: null, items: [] }]);
    await expect(readSharedStock(db, 'client', 'msk', ['a'], orders)).rejects.toThrow('склад');
  });
  it('follows physical WB picking after a task moves to another request', async () => {
    const db = fixture();
    db.fbsTsdAssembly.findMany.mockResolvedValue([{ id: 'wb-task', marketplace: 'WILDBERRIES', connectionId: 'wb', orderId: '1', requestId: 'r', skuId: 'a', itemCount: 5 }]);
    db.stockBalance.findMany.mockResolvedValue([{ skuId: 'a', quantity: 19 }]);
    db.stockMovement.findMany.mockResolvedValue([{ idempotencyKey: 'fbs-sticker-pick:wb-task:old-request', quantity: 1 }]);
    const result = await readSharedStock(db, 'client', 'msk', ['a'], []);
    expect(result.quantities.get('a')).toEqual({ available: 19, reserved: 4, free: 15 });
  });
  it('fails closed on a changed Ozon composition', async () => {
    const db = fixture();
    await expect(readSharedStock(db, 'client', 'msk', ['a', 'b'], [{ ...orders[0], quantity: 3 }, orders[1]])).rejects.toThrow('Состав заказа');
  });
});

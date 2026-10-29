import { beforeEach, describe, expect, it, vi } from 'vitest';
const guard = vi.hoisted(() => ({ request: vi.fn(), use: vi.fn(), finish: vi.fn(), finishRequest: vi.fn(), queued: vi.fn() }));
vi.mock('../src/common/kiz-client-review', () => ({
  assertClientRequestKizShipment: guard.request, assertClientKizUse: guard.use,
  finishClientRequestKizShipment: guard.finishRequest, finishClientKizUse: guard.finish,
  withClientKizReview: async (_db: unknown, _user: unknown, action: () => Promise<unknown>) => {
    try { return await action(); } catch (error) { guard.queued(error); throw error; }
  },
}));
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
import { finalizeWbOrderShipment } from '../src/common/stock/wb-order-stock-lifecycle';

// TEST: manual close and SOS/background stock debit cannot bypass the same client-KIZ decision.
describe('KIZ shipment gates', () => {
  beforeEach(() => { vi.clearAllMocks(); guard.request.mockRejectedValue(new Error('KIZ_REVIEW_REQUIRED')); guard.use.mockRejectedValue(new Error('KIZ_REVIEW_REQUIRED')); });
  it.each(['shipClientRequest', 'shipClientRequestFromCurrentStock'] as const)('%s refuses before stock allocation/debit and persists review outside the failed transaction', async method => {
    const tx = { stockMovement: { findFirst: vi.fn().mockResolvedValue(null) } };
    const db = { fboAssembly: { findUnique: vi.fn().mockResolvedValue(null) }, $transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(tx) };
    const service: any = new StockOperationsService(db as never, {} as never, {} as never);
    const request = { id: 'request', clientId: 'client', warehouseId: 'warehouse', status: 'PACKED', items: [] };
    for (const name of ['assertRequestWarehouse', 'ensureRequestFulfillmentBillingCharges', 'ensureRequestCanMove']) service[name] = vi.fn();
    service.resolveWritableWarehouseId = () => 'warehouse'; service.loadOutboundRequest = async () => request;
    service.ensurePackedStockIsInShipping = vi.fn(); service.planFbsSafeManualShipment = vi.fn();
    await expect(service[method]({ requestId: 'request' }, { id: 'operator' })).rejects.toThrow('KIZ_REVIEW_REQUIRED');
    expect(guard.request).toHaveBeenCalledWith(tx, request, { id: 'operator' });
    expect(service.ensurePackedStockIsInShipping).not.toHaveBeenCalled(); expect(service.planFbsSafeManualShipment).not.toHaveBeenCalled();
    expect(guard.queued).toHaveBeenCalledTimes(1);
  });
  function shipment(existing: unknown = null, legacy: unknown = null) {
    const task = { id: 'task', requestId: 'request', clientId: 'client', marketplace: 'WILDBERRIES', stockWarehouseId: 'warehouse', skuId: 'sku', boxId: 'box', kiz: 'kiz', itemCount: 1 };
    const db: any = { $queryRaw: vi.fn(), fbsTsdAssembly: { findUniqueOrThrow: vi.fn().mockResolvedValue(task) },
      wbOrderShipment: { findUnique: vi.fn().mockResolvedValue(existing) },
      clientRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'request', warehouseId: 'warehouse', status: 'PACKED', items: [], client: { name: 'Client' } }) },
      shippedKizHistory: { findFirst: vi.fn().mockResolvedValue(legacy) }, stockMovement: { findMany: vi.fn() }, stockBalance: { updateMany: vi.fn() } };
    return { db, task };
  }
  it('checks a marked WB dispatch before any physical stock mutation', async () => {
    const { db, task } = shipment();
    await expect(finalizeWbOrderShipment(db, task.id, 'PRINT_CONFIRMED', {})).rejects.toThrow('KIZ_REVIEW_REQUIRED');
    expect(guard.use).toHaveBeenCalledTimes(1); expect(db.stockMovement.findMany).not.toHaveBeenCalled(); expect(db.stockBalance.updateMany).not.toHaveBeenCalled();
  });
  it('returns an existing immutable shipment on retry without consuming or demanding another permission', async () => {
    const fact = { id: 'recorded' }, { db, task } = shipment(fact);
    expect(await finalizeWbOrderShipment(db, task.id, 'PRINT_CONFIRMED', {})).toEqual(fact);
    expect(guard.use).not.toHaveBeenCalled(); expect(guard.finish).not.toHaveBeenCalled();
  });
});

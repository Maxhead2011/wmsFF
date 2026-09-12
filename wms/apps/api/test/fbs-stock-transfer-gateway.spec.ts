import { describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: exercise the actual stock query and routing boundary, not a mocked noStock flag.
function setup() {
  const order = { id: '101', connectionId: 'cabinet', marketplace: 'WILDBERRIES', supplierStatus: 'complete',
    wbStatus: 'waiting', product: { id: 'target-sku' }, itemCount: 1, relabeling: { sourceSkuId: 'physical-sku' } };
  const task = { id: 'task', requestId: 'request', orderId: '101', connectionId: 'cabinet', status: 'WAITING_STOCK', itemCount: 1 };
  const link = { requestId: 'request', orderId: '101', connectionId: 'cabinet', syncStatus: 'ACTIVE',
    request: { warehouseId: 'warehouse', status: 'SUBMITTED' } };
  const db = {
    fbsTsdAssembly: { findMany: vi.fn(async () => [task]) },
    fbsOrderRequestLink: { findMany: vi.fn(async () => [link]) },
    client: { findUniqueOrThrow: vi.fn(async () => ({ storesWithoutBoxes: false })) },
    stockBalance: { findMany: vi.fn(async () => [{ skuId: 'physical-sku', boxId: 'box', quantity: 1 }]) },
    clientRequest: { findMany: vi.fn(async () => [{ id: 'request' }]) },
  };
  const service: any = Object.create(MarketplaceConnectionsService.prototype);
  Object.assign(service, { prisma: db, clientScopes: { requireClientAccess: vi.fn() },
    refreshFbsOrdersCache: vi.fn(async () => ({ orders: [order] })),
    resolveSelectedFbsOrders: vi.fn(async () => ({ orders: [order] })),
    fbsTsdReservationRowsBySku: vi.fn(async () => new Map()) });
  const dto = { clientId: 'client', orders: [{ id: '101', connectionId: 'cabinet' }], sourceRequestId: 'request' };
  const user = { activeWarehouseId: 'warehouse', writableWarehouseIds: ['warehouse'] };
  return { service, db, dto, user, order, task, link };
}
describe('WB stock transfer gateway', () => {
  it('uses the relabel source SKU and only usable balances in the active client and branch', async () => {
    const { service, db, dto, user } = setup();
    expect((await service.prepareFbsStockTransfer(dto, user)).orders[0].noStock).toBe(false);
    expect(db.stockBalance.findMany.mock.calls[0][0]).toMatchObject({ where: {
      clientId: 'client', warehouseId: 'warehouse', skuId: { in: ['physical-sku'] }, status: 'AVAILABLE',
      box: { clientId: 'client', warehouseId: 'warehouse', status: { notIn: ['deleted', 'archived', 'shipped'] },
        storagePlacement: { pallet: { clientId: 'client', warehouseId: 'warehouse' } } } } });
  });
  it('routes zero balances and stock fully reserved by another task to the shortage supply', async () => {
    const { service, db, dto, user } = setup();
    service.fbsTsdReservationRowsBySku.mockResolvedValue(new Map([['physical-sku', [{ taskId: 'other', boxId: 'box', itemCount: 1 }]]]));
    expect((await service.prepareFbsStockTransfer(dto, user)).orders[0].noStock).toBe(true);
    db.stockBalance.findMany.mockResolvedValue([]);
    expect((await service.prepareFbsStockTransfer(dto, user)).orders[0].noStock).toBe(true);
  });
  it('does not subtract a different branch unboxed reservation', async () => {
    const { service, db, dto, user } = setup();
    db.client.findUniqueOrThrow.mockResolvedValue({ storesWithoutBoxes: true });
    db.fbsTsdAssembly.findMany.mockResolvedValueOnce([{ id: 'task', requestId: 'request', orderId: '101', connectionId: 'cabinet', status: 'WAITING_STOCK', itemCount: 1 }]);
    service.fbsTsdReservationRowsBySku.mockResolvedValue(new Map([['physical-sku', [{ taskId: 'foreign-task', boxId: null, itemCount: 1 }]]]));
    expect((await service.prepareFbsStockTransfer(dto, user)).orders[0].noStock).toBe(false);
    expect(db.clientRequest.findMany).toHaveBeenCalledWith({ where: { clientId: 'client', warehouseId: 'warehouse' }, select: { id: true } });
  });
  it('refuses stale source requests, foreign branches and closed requests before stock routing', async () => {
    const { service, db, dto, user, link } = setup();
    await expect(service.prepareFbsStockTransfer({ ...dto, sourceRequestId: 'previous-request' }, user)).rejects.toThrow();
    await expect(service.prepareFbsStockTransfer(dto, { ...user, activeWarehouseId: 'foreign' })).rejects.toThrow();
    link.request.status = 'PACKED';
    await expect(service.prepareFbsStockTransfer(dto, user)).rejects.toThrow();
    expect(db.stockBalance.findMany).not.toHaveBeenCalled();
  });
  it('does not classify a missing product as zero stock or allow duplicate selections', async () => {
    const { service, db, dto, user, order } = setup();
    Object.assign(order, { product: null });
    await expect(service.prepareFbsStockTransfer(dto, user)).rejects.toThrow();
    await expect(service.prepareFbsStockTransfer({ ...dto, orders: [...dto.orders, ...dto.orders] }, user)).rejects.toThrow();
    expect(db.stockBalance.findMany).not.toHaveBeenCalled();
  });
});

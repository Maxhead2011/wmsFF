import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountFbsOrderByWb } from '../src/modules/marketplace-connections/fbs-wb-accounting';

function fixture() {
  for (const flag of ['WMS_FBS_NO_STOCK_TRANSFER_ENABLED', 'WMS_FBS_RESHIPMENT_ENABLED', 'WMS_FBS_TERMINAL_QUEUE_FILTER_ENABLED']) vi.stubEnv(flag, 'true');
  const date = new Date('2026-09-12T08:00:00Z');
  const task: any = { id: 'task', orderId: '5702368259', clientId: 'client', requestId: 'request', connectionId: 'cabinet',
    marketplace: 'WILDBERRIES', status: 'RESERVED', itemCount: 1, supplyId: 'supply', updatedAt: date,
    startedAt: date, reservedBoxId: 'reservation', completedAt: null, barcode: null, kiz: null };
  const link: any = { id: 'link', clientId: 'client', requestId: 'request', syncStatus: 'ACTIVE', updatedAt: date, lastSupplyId: 'supply' };
  const request: any = { clientId: 'client', warehouseId: 'warehouse', status: 'IN_WORK' };
  const db: any = {
    fbsTsdAssembly: { findUnique: vi.fn(async () => task), updateMany: vi.fn(async ({ data }) => { Object.assign(task, data); return { count: 1 }; }) },
    fbsOrderRequestLink: { findUnique: vi.fn(async () => link), updateMany: vi.fn(async ({ data }) => { Object.assign(link, data); return { count: 1 }; }) },
    clientRequest: { findUnique: vi.fn(async () => request) }, auditLog: { create: vi.fn() }, clientRequestEvent: { create: vi.fn() },
    stockBalance: { update: vi.fn() }, stockMovement: { create: vi.fn() }, productMark: { update: vi.fn() },
  };
  db.$transaction = vi.fn(async fn => fn(db));
  const scopes: any = { requireClientAccess: vi.fn() };
  const user: any = { id: 'manager', name: 'Manager', roleCodes: ['MANAGER'], permissionCodes: ['client-requests:write'], activeWarehouseId: 'warehouse', writableWarehouseIds: ['warehouse'] };
  const read = vi.fn(async () => ({ supplierStatus: 'complete', wbStatus: 'sorted', isTransferable: false }));
  const run = () => accountFbsOrderByWb(db, scopes, 'request', 'task', { comment: 'Проверено менеджером' }, user, read);
  return { task, link, request, db, user, read, run, scopes };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('manager accounting by fresh WB status', () => {
  // TEST: no completed timestamp, barcode, KIZ, stock deduction or new supply is manufactured.
  it('accounts once, releases only the unpicked reservation and preserves order/request/supply identity', async () => {
    const f = fixture();
    expect(await f.run()).toMatchObject({ accounted: true, orderId: '5702368259' });
    expect(f.task).toMatchObject({ status: 'WB_ACCOUNTED', requestId: 'request', supplyId: 'supply', reservedBoxId: null, completedAt: null, barcode: null, kiz: null });
    expect(f.link).toMatchObject({ syncStatus: 'WB_ACCOUNTED', requestId: 'request', lastSupplyId: 'supply' });
    expect(f.db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'manager', action: 'FBS_WB_ORDER_ACCOUNTED',
      payload: expect.objectContaining({ confirmedByName: 'Manager', wbStatus: 'sorted', isTransferable: false, stockMutationPerformed: false }) }) });
    await f.run();
    expect(f.read).toHaveBeenCalledTimes(1); expect(f.db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(f.db.clientRequestEvent.create).toHaveBeenCalledTimes(1);
    expect(f.db.stockBalance.update).not.toHaveBeenCalled(); expect(f.db.stockMovement.create).not.toHaveBeenCalled(); expect(f.db.productMark.update).not.toHaveBeenCalled();
  });
  it.each(['waiting', 'canceled_by_client', 'defect', 'unknown'])('rejects WB %s without writing', async wbStatus => {
    const f = fixture(); f.read.mockResolvedValue({ supplierStatus: 'complete', wbStatus, isTransferable: false });
    await expect(f.run()).rejects.toThrow('WB не подтвердил'); expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it.each([true, undefined])('requires an explicit WB transfer prohibition: %s', async isTransferable => {
    const f = fixture(); f.read.mockResolvedValue({ supplierStatus: 'complete', wbStatus: 'sorted', isTransferable } as any);
    await expect(f.run()).rejects.toThrow('WB не подтвердил'); expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it.each(['boxId', 'barcode', 'kiz', 'sourceBarcode', 'completedAt', 'sourceBoxPending', 'relabelConfirmedAt', 'cargoPackingId', 'cargoPackedAt', 'marketplaceSubmittedAt', 'stickerBarcode', 'stickerPartA', 'stickerPartB'])('preserves physical evidence %s', async field => {
    const f = fixture(); f.task[field] = 'evidence';
    await expect(f.run()).rejects.toThrow('физические сканы'); expect(f.read).not.toHaveBeenCalled();
  });
  it.each(['IN_PROGRESS', 'COMPLETED', 'RETURN_REQUIRED'])('blocks physical workflow %s', async status => {
    const f = fixture(); f.task.status = status; await expect(f.run()).rejects.toThrow(); expect(f.read).not.toHaveBeenCalled();
  });
  it.each(['demo', 'client', 'read-only', 'other-branch', 'other-client', 'closed', 'disabled'])('enforces %s isolation before WB', async scenario => {
    const f = fixture();
    if (scenario === 'demo') f.user.isDemo = true;
    if (scenario === 'client') f.user.roleCodes = ['CLIENT'];
    if (scenario === 'read-only') f.user.permissionCodes = ['client-requests:read'];
    if (scenario === 'other-branch') f.user.activeWarehouseId = 'other';
    if (scenario === 'other-client') f.scopes.requireClientAccess.mockImplementation(() => { throw new Error('scope denied'); });
    if (scenario === 'closed') f.request.status = 'DONE';
    if (scenario === 'disabled') vi.stubEnv('WMS_FBS_NO_STOCK_TRANSFER_ENABLED', 'false');
    await expect(f.run()).rejects.toThrow(); expect(f.read).not.toHaveBeenCalled(); expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects a simultaneous scan after WB is read', async () => {
    const f = fixture(); f.read.mockImplementation(async () => { f.task.barcode = 'scanned'; return { supplierStatus: 'complete', wbStatus: 'sorted', isTransferable: false }; });
    await expect(f.run()).rejects.toThrow('изменился'); expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  });
  it('rechecks the active request inside the transaction', async () => {
    const f = fixture(); f.read.mockImplementation(async () => { f.request.status = 'DONE'; return { supplierStatus: 'complete', wbStatus: 'sorted', isTransferable: false }; });
    await expect(f.run()).rejects.toThrow('закрыта'); expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  });
  it('does not write after a WB timeout', async () => {
    const f = fixture(); f.read.mockRejectedValue(new Error('WB timeout')); await expect(f.run()).rejects.toThrow('WB timeout'); expect(f.db.$transaction).not.toHaveBeenCalled();
  });
});

// TEST: the public service must use this cabinet and reject a status belonging to another order.
describe('WB accounting gateway', () => {
  it.each([5702368259, 999])('checks the exact WB order in a scoped live response: %s', async responseId => {
    const f = fixture();
    f.db.clientMarketplaceConnection = { findFirst: vi.fn(async () => ({ apiKey: 'test-key' })) };
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ orders: [
      { id: responseId, supplierStatus: 'complete', wbStatus: 'sorted', isTransferable: false },
    ] }) }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new MarketplaceConnectionsService(f.db, f.scopes);
    const result = service.accountFbsOrderByWb('request', 'task', { comment: 'Проверено' }, f.user);
    if (responseId === 5702368259) await expect(result).resolves.toMatchObject({ accounted: true });
    else { await expect(result).rejects.toThrow('однозначный статус'); expect(f.db.$transaction).not.toHaveBeenCalled(); }
    expect(f.db.clientMarketplaceConnection.findFirst).toHaveBeenCalledWith({ where: {
      id: 'cabinet', clientId: 'client', marketplace: 'WILDBERRIES', isActive: true,
    } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://marketplace-api.wildberries.ru/api/v3/orders/status', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ orders: [5702368259] }),
    }));
  });
});

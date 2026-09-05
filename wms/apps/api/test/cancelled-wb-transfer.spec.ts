import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareCancelledWbTransfer, validateCancelledWbTransfer } from '../src/modules/stock/cancelled-wb-transfer';

// TEST: read-only WB guard; the stock service supplies its existing GS1 parser.
const kiz = '01046809925989502154asVoN1CieXb';
const parse = (value: string) => value.split('\u001d')[0] === kiz
  ? { gtin: '04680992598950', serial: '54asVoN1CieXb' } : null;
function fixture() {
  vi.stubEnv('WMS_TSD_CANCELLED_WB_TRANSFER_ENABLED', 'true');
  const mark = { id: 'mark', clientId: 'client', skuId: 'sku', boxId: 'old', status: 'SHIPPING',
    value: kiz, updatedAt: new Date('2026-08-31'), stockMovementId: null };
  const task = { id: 'task', clientId: 'client', marketplace: 'WILDBERRIES', connectionId: 'connection',
    orderId: '5544665829', kiz, status: 'COMPLETED', updatedAt: new Date('2026-08-24') };
  const connection = { clientId: 'client', marketplace: 'WILDBERRIES', isActive: true, apiKey: 'test-only-secret' };
  const db = {
    productMark: { findFirst: vi.fn(async () => mark), count: vi.fn(async () => 0) },
    box: { findUnique: vi.fn(async () => ({ id: 'old', clientId: 'client', warehouseId: 'warehouse' })) },
    fbsTsdAssembly: { findMany: vi.fn(async () => [task]), findFirst: vi.fn(async (): Promise<any> => null) },
    shippedKizHistory: { findMany: vi.fn(async (): Promise<any[]> => []) },
    fbsWebKizStickerPrint: { findMany: vi.fn(async (): Promise<any[]> => []) },
    fbsAssemblyAttemptHistory: { findFirst: vi.fn(async (): Promise<any> => null) },
    clientMarketplaceConnection: { findUnique: vi.fn(async () => connection) },
    stockMovement: { findUnique: vi.fn(async () => null) },
  };
  const input = { source: { id: 'source', code: 'FFL_SOURCE', clientId: 'client', warehouseId: 'warehouse' },
    skuId: 'sku', availableQuantity: 1, scanCode: kiz };
  const remote = vi.fn(async () => new Response(JSON.stringify({ orders: [{ id: 5544665829, supplierStatus: 'cancel', wbStatus: 'canceled' }] })));
  vi.stubGlobal('fetch', remote);
  return { db, input, remote, mark, task, connection, prepare: () => prepareCancelledWbTransfer(db as never, input, parse) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('Cancelled WB physical-transfer guard', () => {
  it('only calls the read-only order status endpoint for the linked cabinet/order', async () => {
    const f = fixture(); const proof = await f.prepare();
    expect(f.remote).toHaveBeenCalledWith('https://marketplace-api.wildberries.ru/api/v3/orders/status', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ orders: [5544665829] }), signal: expect.any(AbortSignal),
    }));
    expect(JSON.stringify(proof)).not.toContain('test-only-secret');
    await validateCancelledWbTransfer(f.db as never, proof!, f.input, parse);
    expect(f.remote).toHaveBeenCalledTimes(1);
  });

  it.each(['canceled', 'canceled_by_client', 'declined_by_client'])('accepts explicit terminal cancellation %s', async wbStatus => {
    const f = fixture(); f.remote.mockResolvedValue(new Response(JSON.stringify({ orders: [{ id: 5544665829, supplierStatus: 'complete', wbStatus }] })));
    await expect(f.prepare()).resolves.toMatchObject({ wbStatus });
  });

  it.each(['wrong client', 'wrong sku', 'wrong identity', 'defect', 'no stock', 'full marks', 'wrong branch',
    'no order', 'two orders', 'ozon', 'another shipment', 'another print', 'archived attempt', 'competing task', 'wrong cabinet', 'inactive cabinet'])(
    'does not contact WB or permit movement for %s', async fault => {
      const f = fixture();
      if (fault === 'wrong client') f.mark.clientId = 'another';
      if (fault === 'wrong sku') f.mark.skuId = 'another';
      if (fault === 'wrong identity') f.mark.value = `${kiz}different-serial`;
      if (fault === 'defect') f.mark.status = 'DEFECT';
      if (fault === 'no stock') f.input.availableQuantity = 0;
      if (fault === 'full marks') f.db.productMark.count.mockResolvedValue(1);
      if (fault === 'wrong branch') f.input.source.warehouseId = 'other';
      if (fault === 'no order') f.db.fbsTsdAssembly.findMany.mockResolvedValue([]);
      if (fault === 'two orders') f.db.fbsTsdAssembly.findMany.mockResolvedValue([f.task, { ...f.task, id: 'other' }]);
      if (fault === 'ozon') f.task.marketplace = 'OZON';
      if (fault === 'another shipment') f.db.shippedKizHistory.findMany.mockResolvedValue([{ id: 'other', clientId: 'client', assemblyId: 'other', orderId: '123', kiz }]);
      if (fault === 'another print') f.db.fbsWebKizStickerPrint.findMany.mockResolvedValue([{ id: 'other', clientId: 'client', assemblyId: 'other', orderId: '123', kiz }]);
      if (fault === 'archived attempt') f.db.fbsAssemblyAttemptHistory.findFirst.mockResolvedValue({ id: 'archive' });
      if (fault === 'competing task') f.db.fbsTsdAssembly.findFirst.mockResolvedValue({ id: 'other' });
      if (fault === 'wrong cabinet') f.connection.clientId = 'other';
      if (fault === 'inactive cabinet') f.connection.isActive = false;
      await expect(f.prepare()).rejects.toThrow(); expect(f.remote).not.toHaveBeenCalled();
    });

  it.each(['missing', 'wrong order', 'duplicate', 'bad json', 'timeout'])('fails closed on %s WB response', async fault => {
    const f = fixture();
    const status = { id: 5544665829, supplierStatus: 'cancel', wbStatus: 'canceled' };
    if (fault === 'missing') f.remote.mockResolvedValue(new Response('{}'));
    if (fault === 'wrong order') f.remote.mockResolvedValue(new Response(JSON.stringify({ orders: [{ ...status, id: 123 }] })));
    if (fault === 'duplicate') f.remote.mockResolvedValue(new Response(JSON.stringify({ orders: [status, status] })));
    if (fault === 'bad json') f.remote.mockResolvedValue(new Response('not-json'));
    if (fault === 'timeout') f.remote.mockRejectedValue(new Error('test-only-secret transport timeout'));
    await expect(f.prepare()).rejects.toThrow(/Не удалось проверить/);
    try { await f.prepare(); } catch (error) { expect(String(error)).not.toContain('test-only-secret'); }
  });

  it('expires a successful WB check before stock execution', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture();
    const proof = await f.prepare(); vi.setSystemTime(Date.now() + 15_001);
    await expect(validateCancelledWbTransfer(f.db as never, proof!, f.input, parse)).rejects.toThrow();
  });

  it('does not reuse confirmation for another source or SKU', async () => {
    const f = fixture(); const proof = await f.prepare();
    await expect(validateCancelledWbTransfer(f.db as never, proof!, { ...f.input, skuId: 'other' }, parse)).rejects.toThrow();
    await expect(validateCancelledWbTransfer(f.db as never, proof!, { ...f.input, source: { ...f.input.source, id: 'other' } }, parse)).rejects.toThrow();
  });

  it('does not perform WB requests for AVAILABLE marks', async () => {
    const f = fixture(); f.mark.status = 'AVAILABLE';
    await expect(f.prepare()).resolves.toBeUndefined(); expect(f.remote).not.toHaveBeenCalled();
  });
});

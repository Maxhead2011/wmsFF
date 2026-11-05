import { describe, expect, it, vi } from 'vitest';
import { writeFabricProduction } from './fabric-fbs-production';
const proof = { key: 'key', taskId: 'task', clientId: 'client', requestId: 'request', marketplace: 'OZON', connectionId: 'cabinet',
  orderId: 'order', lineId: 'line', skuId: 'sku', warehouseId: 'w', material: 'SATIN', color: 'white', units: 2, mm: 6000, userId: 'u', deviceCode: 'tsd', at: '2026-11-05T07:00:00Z' };
function fixture() {
  return { stockMovement: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    stockBalance: { upsert: vi.fn().mockResolvedValue({}) }, auditLog: { create: vi.fn().mockResolvedValue({}) },
    clientRequestEvent: { create: vi.fn().mockResolvedValue({}) } };
}
describe('fabric production stock writer', () => {
  // TEST: production creates order-owned PACKING, not a fictional ready-stock receipt.
  it('records one stock movement, packed balance and actor evidence', async () => {
    const tx = fixture(); await writeFabricProduction(tx as never, proof);
    expect(tx.stockMovement.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'PACKING', quantity: 2,
      sourceDocument: 'request', boxId: null, idempotencyKey: 'fbs-sticker-pick:task:fabric:key' }) });
    expect(tx.stockBalance.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { balanceKey: 'client:sku:no-box:no-pallet:PACKING:warehouse:w' },
      update: { quantity: { increment: 2 } } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'FABRIC_FBS_CUT', userId: 'u', payload: expect.objectContaining(proof) }) });
    expect(tx.clientRequestEvent.create).toHaveBeenCalledTimes(1);
  });
  it('refuses an existing movement so the caller rolls back another material debit', async () => {
    const tx = fixture(); tx.stockMovement.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(writeFabricProduction(tx as never, proof)).rejects.toThrow('уже записана');
    expect(tx.stockMovement.create).not.toHaveBeenCalled(); expect(tx.stockBalance.upsert).not.toHaveBeenCalled();
  });
  it('records the reduction in raw storage volume alongside production', async () => {
    const tx = fixture(); await writeFabricProduction(tx as never, proof);
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ payload: expect.objectContaining({
      material: 'SATIN', color: 'white', warehouseId: 'w', storageRollEquivalentDelta: -0.06, volumeLiters: 24.740,
    }) }) });
  });
  it.each([0, -1, 0.5, NaN])('rejects invalid quantity %s before writing', async units => {
    const tx = fixture(); await expect(writeFabricProduction(tx as never, { ...proof, units })).rejects.toThrow('Некорректное');
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });
  it('propagates audit failure for transaction rollback', async () => {
    const tx = fixture(); tx.auditLog.create.mockRejectedValue(new Error('audit failed'));
    await expect(writeFabricProduction(tx as never, proof)).rejects.toThrow('audit failed');
    expect(tx.clientRequestEvent.create).not.toHaveBeenCalled();
  });
});

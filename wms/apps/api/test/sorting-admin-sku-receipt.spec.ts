import { expect, it, vi } from 'vitest';
import { settleAdminSortingSkuReceipt } from '../src/modules/stock/sorting-admin-sku-receipt';
function fixture() {
  const mark: any = { id: 'mark', status: 'PACKING', boxId: null, sourceDocument: 'request', clientId: 'client', skuId: 'sku' };
  const source = { id: 'source', requestId: 'request', skuId: 'sku', clientId: 'client', receivedQuantity: 1, updatedAt: new Date() };
  const scan = { id: 'scan', kiz: 'EXACT', source, updatedAt: new Date() };
  const tx: any = { $queryRaw: vi.fn(), clientRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'request', type: 'SKU_COLLECTION', clientId: 'client', status: 'PACKED' }), update: vi.fn() },
    skuCollectionScan: { findMany: vi.fn().mockResolvedValue([scan]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    skuCollectionSource: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), aggregate: vi.fn().mockResolvedValue({ _sum: { plannedQuantity: 2, pickedQuantity: 2, receivedQuantity: 2 } }) }, auditLog: { create: vi.fn() } };
  const run = () => settleAdminSortingSkuReceipt(tx, mark, { id: 'target', code: 'TARGET' }, { gtin: 'gtin', serial: 'serial' }, v => v === 'EXACT' ? { gtin: 'gtin', serial: 'serial' } : null, { id: 'admin', name: 'Admin' } as any);
  return { tx, mark, scan, run };
}
it('settles the original collection once without creating another stock movement', async () => {
  // TEST: physical transfer owns quantity; this adapter must only close the checklist.
  const f = fixture(); await f.run();
  expect(f.tx.skuCollectionScan.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RECEIVED', targetBoxId: 'target' }) }));
  expect(f.tx.skuCollectionSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { receivedQuantity: { increment: 1 } } }));
  expect(f.tx.clientRequest.update).toHaveBeenCalledWith({ where: { id: 'request' }, data: { status: 'DONE' } });
  expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
  f.tx.skuCollectionScan.findMany.mockResolvedValue([]); await f.run();
  expect(f.tx.skuCollectionSource.updateMany).toHaveBeenCalledTimes(1);
});
it.each(['boxed', 'available', 'no-document', 'different-identity', 'non-collection'])('leaves unrelated workflow untouched: %s', async kind => {
  // TEST: only the exact picked identity is settled.
  const f = fixture();
  if (kind === 'boxed') f.mark.boxId = 'box';
  if (kind === 'available') f.mark.status = 'AVAILABLE';
  if (kind === 'no-document') f.mark.sourceDocument = null;
  if (kind === 'different-identity') f.scan.kiz = 'OTHER';
  if (kind === 'non-collection') f.tx.clientRequest.findUnique.mockResolvedValue({ type: 'FBS' });
  await f.run(); expect(f.tx.skuCollectionScan.updateMany).not.toHaveBeenCalled();
});
it.each(['scan', 'counter', 'duplicate'])('aborts the owning transaction on %s conflict', async kind => {
  // TEST: never commit stock with a double or racing collection receipt.
  const f = fixture();
  if (kind === 'scan') f.tx.skuCollectionScan.updateMany.mockResolvedValue({ count: 0 });
  if (kind === 'counter') f.tx.skuCollectionSource.updateMany.mockResolvedValue({ count: 0 });
  if (kind === 'duplicate') f.tx.skuCollectionScan.findMany.mockResolvedValue([f.scan, f.scan]);
  await expect(f.run()).rejects.toThrow();
});
it('does not reopen a cancelled request while recording its physical receipt', async () => {
  // TEST: terminal request decisions stay immutable.
  const f = fixture(); f.tx.clientRequest.findUnique.mockResolvedValue({ id: 'request', type: 'SKU_COLLECTION', clientId: 'client', status: 'CANCELLED' });
  await f.run(); expect(f.tx.clientRequest.update).not.toHaveBeenCalled(); expect(f.tx.skuCollectionScan.updateMany).toHaveBeenCalled();
});

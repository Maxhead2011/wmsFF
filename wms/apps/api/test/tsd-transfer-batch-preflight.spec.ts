import { describe, expect, it, vi } from 'vitest';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

// TEST: execute the real batch handler; stock writes are observable and must not start on invalid batches.
function fixture(quantities: Record<string, number> = { a: 6 }) {
  const remaining = { ...quantities };
  const tx: any = {
    stockMovement: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => ({ id: 'in' })) },
    stockBalance: { aggregate: vi.fn(async () => ({ _sum: { quantity: Object.values(remaining).reduce((a, b) => a + b, 0) } })) },
    productMark: { update: vi.fn(), count: vi.fn(async () => 0) },
    box: { update: vi.fn(), findUnique: vi.fn(async () => ({ id: 'source', status: 'active' })) },
  };
  const service: any = Object.create(StockOperationsService.prototype);
  service.prisma = { $transaction: (fn: any) => fn(tx) };
  service.clientScopes = { requireClientAccess: vi.fn() };
  service.resolveWritableWarehouseId = () => 'wh';
  service.loadTsdTransferSourceBox = vi.fn(async () => {
    if (!Object.values(remaining).some(q => q > 0)) throw new Error('нет доступного товара для перемещения');
    return { id: 'source', code: 'FFL_LKB2107_22', clientId: 'client', warehouseId: 'wh',
      balances: Object.entries(remaining).map(([skuId, quantity]) => ({ skuId, quantity })) };
  });
  service.resolveTsdTransferScannedItem = vi.fn(async (_tx: any, source: any, scanCode: string) => {
    if (scanCode === 'INVALID') throw new Error('Неверный КИЗ');
    const skuId = scanCode.split('-')[0];
    return { sku: { id: skuId, name: `Товар ${skuId}`, article: `ART-${skuId}`, size: 'S / 42', barcodes: [] },
      scanType: scanCode.includes('barcode') ? 'BARCODE' : 'KIZ', scanCode,
      productMarkId: scanCode.includes('barcode') ? null : scanCode,
      availableQuantity: source.balances.find((b: any) => b.skuId === skuId)?.quantity ?? 0 };
  });
  service.ensureTargetBox = vi.fn(async () => ({ id: 'target', code: 'FFL_TARGET' }));
  service.applyTransferBetweenBoxes = vi.fn(async (_tx: any, input: any) => { remaining[input.skuId]--; });
  const run = (scans: string[]) => service.executeTsdTransferBatch({ fromBoxCode: 'FFL_LKB2107_22',
    toBoxCode: 'FFL_TARGET', scanCodes: scans, idempotencyKey: 'batch-test' }, { id: 'u', activeWarehouseId: 'wh' });
  return { service, tx, run };
}

describe('TSD batch preflight', () => {
  it('reports 7 scanned versus 6 available before creating target or moving any unit', async () => {
    const f = fixture();
    await expect(f.run(Array.from({ length: 7 }, (_, i) => `a-${i}`))).rejects.toThrow(/отсканировано 7.*доступно 6/);
    expect(f.service.ensureTargetBox).not.toHaveBeenCalled();
    expect(f.service.applyTransferBetweenBoxes).not.toHaveBeenCalled();
    expect(f.tx.productMark.update).not.toHaveBeenCalled();
  });
  it('checks each SKU, not the total quantity of different products', async () => {
    const f = fixture({ a: 1, b: 20 });
    await expect(f.run(['a-1', 'a-2', 'b-1'])).rejects.toThrow(/отсканировано 2.*доступно 1/);
    expect(f.service.applyTransferBetweenBoxes).not.toHaveBeenCalled();
  });
  it('rejects duplicate KIZ before any writes', async () => {
    const f = fixture();
    await expect(f.run(['a-1', 'a-1'])).rejects.toThrow(/повторно/);
    expect(f.service.ensureTargetBox).not.toHaveBeenCalled();
    expect(f.service.applyTransferBetweenBoxes).not.toHaveBeenCalled();
  });
  it('rejects a bad later scan before any writes', async () => {
    const f = fixture();
    await expect(f.run(['a-1', 'INVALID'])).rejects.toThrow('Неверный КИЗ');
    expect(f.service.applyTransferBetweenBoxes).not.toHaveBeenCalled();
  });
  it('moves exactly the available quantity', async () => {
    const f = fixture({ a: 2 });
    await expect(f.run(['a-1', 'a-2'])).resolves.toMatchObject({ status: 'APPLIED', movedQuantity: 2, sourceRemaining: 0 });
    expect(f.service.applyTransferBetweenBoxes).toHaveBeenCalledTimes(2);
  });
  it('allows repeated product barcodes for separate unmarked units', async () => {
    const f = fixture({ a: 2 });
    await expect(f.run(['a-barcode', 'a-barcode'])).resolves.toMatchObject({ movedQuantity: 2 });
  });
  it('keeps idempotent replay ahead of preflight on an already emptied source', async () => {
    const f = fixture({ a: 0 });
    f.tx.stockMovement.findFirst.mockResolvedValue({ clientId: 'client' });
    await expect(f.run(['a-1'])).resolves.toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(f.service.loadTsdTransferSourceBox).not.toHaveBeenCalled();
  });
});

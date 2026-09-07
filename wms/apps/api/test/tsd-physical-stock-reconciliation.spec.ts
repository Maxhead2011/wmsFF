import { describe, it, expect, vi } from 'vitest';
import { readPhysicalStockRecovery } from '../src/modules/stock/tsd-physical-stock-reconciliation';

// TEST: zero-balance recovery is based on one physical identity, never a box-wide mark count.
const identity = { gtin: '04600000000001', serial: 'SERIAL-00001' };
const code = `01${identity.gtin}21${identity.serial}`;
function fixture() {
  const mark = { id: 'mark', clientId: 'c', skuId: 's', boxId: 'b', status: 'AVAILABLE', value: code, updatedAt: new Date(), stockMovementId: 'receipt' };
  const db: any = {
    productMark: { findMany: vi.fn(async () => [mark]) },
    box: { findUnique: vi.fn(async () => ({ id: 'old', code: 'OLD', clientId: 'c', warehouseId: 'w' })) },
    stockBalance: { findFirst: vi.fn(async () => null) },
    stockMovement: { findUnique: vi.fn(async () => null) },
    fbsTsdAssembly: { findFirst: vi.fn(async () => null) },
    shippedKizHistory: { findFirst: vi.fn(async () => null) },
    fbsWebKizStickerPrint: { findFirst: vi.fn(async () => null) },
    fbsPrintJob: { findFirst: vi.fn(async () => null) },
    fbsAssemblyAttemptHistory: { findFirst: vi.fn(async () => null) },
    kizCirculationItem: { findFirst: vi.fn(async () => null) },
  };
  const input = { source: { id: 'b', code: 'BOX', clientId: 'c', warehouseId: 'w', status: 'active', palletId: null }, skuId: 's', scanCode: code };
  const run = () => readPhysicalStockRecovery(db, input, () => identity);
  return { db, mark, input, run };
}
describe('physical zero-stock recovery proof', () => {
  it('reuses the existing same-box mark', async () => {
    const f = fixture(); expect(await f.run()).toMatchObject({ mark: { id: 'mark' }, restoreQuantity: 1 });
  });
  it('accepts a new physical identity for later atomic registration', async () => {
    const f = fixture(); f.db.productMark.findMany.mockResolvedValue([]);
    expect(await f.run()).toMatchObject({ mark: null, restoreQuantity: 1 });
  });
  it.each(['clientId', 'skuId', 'status'])('rejects conflicting mark %s', async field => {
    const f = fixture(); (f.mark as any)[field] = 'other'; await expect(f.run()).rejects.toThrow();
  });
  it('rejects duplicate physical identities', async () => {
    const f = fixture(); f.db.productMark.findMany.mockResolvedValue([f.mark, { ...f.mark, id: 'other' }]); await expect(f.run()).rejects.toThrow();
  });
  it('rejects a missing/malformed identity', async () => {
    const f = fixture(); await expect(readPhysicalStockRecovery(f.db, f.input, () => null)).rejects.toThrow();
  });
  it('does not restore an identity that was already recovered and moved', async () => {
    const f = fixture(); f.db.stockMovement.findUnique.mockResolvedValue({ id: 'prior' }); await expect(f.run()).rejects.toThrow();
  });
  it.each(['fbsTsdAssembly','shippedKizHistory','fbsWebKizStickerPrint','fbsPrintJob','fbsAssemblyAttemptHistory','kizCirculationItem'])('retains the %s guard', async table => {
    const f = fixture(); f.db[table].findFirst.mockResolvedValue({ id: 'conflict' }); await expect(f.run()).rejects.toThrow();
  });
  it('rejects in-process stock in the physical source', async () => {
    const f = fixture(); f.db.stockBalance.findFirst.mockResolvedValue({ id: 'packing' }); await expect(f.run()).rejects.toThrow();
  });
  it('allows a stale old-box link only when that box is empty for this SKU', async () => {
    const f = fixture(); f.mark.boxId = 'old'; expect(await f.run()).toMatchObject({ previousBoxCode: 'OLD' });
  });
  it('rejects another warehouse even when its old box is empty', async () => {
    const f = fixture(); f.mark.boxId = 'old'; f.db.box.findUnique.mockResolvedValue({ id: 'old', clientId: 'c', warehouseId: 'other' }); await expect(f.run()).rejects.toThrow();
  });
  it('rejects restoration while the old box still has stock', async () => {
    const f = fixture(); f.mark.boxId = 'old'; f.db.stockBalance.findFirst.mockImplementation(async ({ where }: any) => where.boxId === 'old' ? { id: 'balance' } : null); await expect(f.run()).rejects.toThrow();
  });
  // TEST: a stale old-box assignment can itself be held by another in-progress task.
  it('rejects an active task in the old box even without a balance', async () => {
    const f = fixture(); f.mark.boxId = 'old';
    f.db.fbsTsdAssembly.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'old-active-task' });
    await expect(f.run()).rejects.toThrow();
  });
});

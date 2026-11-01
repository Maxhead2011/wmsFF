import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

const startedAt = new Date('2026-09-09T12:49:59.149Z');
const kiz = '0104680992598806215oHSJh0?ojPSg\u001d91EE12\u001d92proof';
const user = { id: 'admin', roleCodes: ['ADMIN'], permissionCodes: ['stock:write'], activeWarehouseId: 'moscow',
  warehouseIds: ['moscow'], writableWarehouseIds: ['moscow'] } as any;
function fixture() {
  const balance = { id: 'stock', clientId: 'client', warehouseId: 'moscow', skuId: 'sku',
    boxId: 'source', palletId: null, status: 'AVAILABLE', quantity: 5 };
  const source = { id: 'source', clientId: 'client', warehouseId: 'moscow', code: 'FFL_LKB1807_48',
    status: 'active', palletId: null, balances: [balance], productMarks: [] as any[] };
  const audit = { id: 'count', startedAt, status: 'RESOLVED', lines: [
    { id: 'line', skuId: 'sku', decision: 'APPLY_ACTUAL', difference: 5, countedQuantity: 5 },
  ] };
  const evidence = { payload: { boxId: 'source', clientId: 'client', skuId: 'sku', lineId: 'line',
    roundStartedAt: startedAt.toISOString(), kiz } };
  const tx = {
    box: { findUnique: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce({
      id: 'target', code: 'FFL_LKBBOX_044', warehouseId: 'moscow', status: 'active', palletId: null,
    }), create: vi.fn(), update: vi.fn() },
    stockMovement: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'movement' }) },
    stockBalance: { update: vi.fn().mockResolvedValue({}), delete: vi.fn(), upsert: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    productMark: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0) },
    inventoryAuditBox: { findFirst: vi.fn().mockResolvedValue(audit) },
    auditLog: { findMany: vi.fn().mockResolvedValue([evidence]), create: vi.fn() },
  };
  const prisma = { $transaction: vi.fn(async fn => fn(tx)) };
  const service = new StockOperationsService(prisma as any, { requireClientAccess: vi.fn() } as any,
    { balanceKey: () => 'target-balance' } as any);
  const run = () => service.transferWholeBox({ clientId: 'client', fromBoxCode: source.code,
    toBoxCode: 'FFL_LKBBOX_044', idempotencyKey: 'tsd-inventory-consolidation:count:target' }, user);
  return { source, tx, audit, evidence, run };
}
describe('whole-box consolidation keeps counted KIZ and stock consistent', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('blocks box 044 scenario before quantity moves when scanned KIZ remain in another box', async () => {
    // TEST: the count includes five units, but their marks still belong to old box 082.
    vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
    const f = fixture();
    await expect(f.run()).rejects.toThrow('Сортировка и перемещение');
    expect(f.tx.stockBalance.update).not.toHaveBeenCalled();
    expect(f.tx.stockBalance.upsert).not.toHaveBeenCalled();
    expect(f.tx.stockMovement.create).not.toHaveBeenCalled();
    expect(f.tx.productMark.updateMany).not.toHaveBeenCalled();
    expect(f.tx.box.create).not.toHaveBeenCalled();
  });
  it.each(['wrong-sku', 'SHIPPING', 'wrong-case'])('rejects an incompatible local KIZ: %s', async kind => {
    // TEST: matching text alone must not adopt a different SKU or already shipped item.
    vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
    const f = fixture(); f.source.productMarks.push({ id: 'mark', skuId: kind === 'wrong-sku' ? 'other' : 'sku',
      status: kind === 'SHIPPING' ? 'SHIPPING' : 'AVAILABLE', value: kind === 'wrong-case' ? kiz.toLowerCase() : kiz });
    await expect(f.run()).rejects.toThrow('Сортировка и перемещение');
    expect(f.tx.stockMovement.create).not.toHaveBeenCalled();
  });
  it('allows compatible marks, including a scanner prefix and visible GS separators', async () => {
    // TEST: canonical identity survives representation differences without ignoring letter case.
    vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
    const f = fixture(); f.source.productMarks.push({ id: 'mark', skuId: 'sku', status: 'AVAILABLE', value: kiz });
    f.evidence.payload.kiz = ']d2' + kiz.replaceAll('\u001d', '<GS>');
    await expect(f.run()).resolves.toMatchObject({ status: 'APPLIED', quantity: 5 });
  });
  it('checks a matched count even if another line needed resolution', async () => {
    // TEST: KEEP_SYSTEM with zero difference is physical confirmation too.
    vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
    const f = fixture(); f.audit.lines[0].decision = 'KEEP_SYSTEM'; f.audit.lines[0].difference = 0;
    await expect(f.run()).rejects.toThrow('Сортировка и перемещение');
  });
  it.each(['older-round', 'no-scans', 'not-confirmed'])('does not reinterpret unrelated evidence: %s', async kind => {
    // TEST: only this completed counting round may introduce the new restriction.
    vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true'); const f = fixture();
    if (kind === 'older-round') f.evidence.payload.roundStartedAt = '2026-09-08T00:00:00.000Z';
    if (kind === 'no-scans') f.tx.auditLog.findMany.mockResolvedValue([]);
    if (kind === 'not-confirmed') f.audit.status = 'COUNTING';
    await expect(f.run()).resolves.toMatchObject({ status: 'APPLIED' });
  });
  it('preserves the sold VM path while the sorting flag is off', async () => {
    // TEST: no new queries or behavior in configurations without administrative sorting.
    vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'false'); const f = fixture();
    await expect(f.run()).resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.tx.inventoryAuditBox.findFirst).not.toHaveBeenCalled();
  });
});

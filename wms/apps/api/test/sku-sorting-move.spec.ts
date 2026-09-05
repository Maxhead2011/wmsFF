import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkuSortingService } from '../src/modules/inventory/sku-sorting.service';

afterEach(() => vi.unstubAllEnvs());
const user: any = { id: 'user', name: 'Test', activeWarehouseId: 'warehouse', permissionCodes: ['system:admin'] };
function fixture() {
  vi.stubEnv('WMS_SKU_SORTING_ENABLED', 'true');
  const source = { id: 'source', sourceBoxId: 'box', sourceBoxCode: 'BOX', skuId: 'sku', plannedQuantity: 2, pickedQuantity: 0, receivedQuantity: 0 };
  const request = { id: 'request', type: 'SKU_COLLECTION', status: 'IN_WORK', clientId: 'client', warehouseId: 'warehouse', comment: '[SKU_SORTING_V2]', skuCollectionSources: [source] };
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    inventorySession: { findFirst: vi.fn().mockResolvedValue(null) },
    clientRequest: { findFirst: vi.fn().mockResolvedValue(request), update: vi.fn() },
    clientRequestItem: { updateMany: vi.fn() },
    skuCollectionScan: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    skuCollectionSource: { update: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _sum: { plannedQuantity: 2, pickedQuantity: 1, receivedQuantity: 1 } }) },
    sku: { findUnique: vi.fn().mockResolvedValue({ barcodes: [{ value: '123' }] }) },
    inventoryAuditBox: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue({ id: 'audit', boxId: 'box', clientId: 'client', status: 'MATCHED', session: { warehouseId: 'warehouse' }, lines: [{ skuId: 'sku', decision: 'KEEP_SYSTEM', countedQuantity: 2 }] }) },
    box: { findFirst: vi.fn().mockResolvedValue({ id: 'target', code: 'TARGET', clientId: 'client', warehouseId: 'warehouse', palletId: null }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    productMark: { findFirst: vi.fn().mockResolvedValue({ id: 'mark', skuId: 'sku', boxId: 'box', status: 'AVAILABLE', value: 'kiz' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    stockBalance: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 0 } }), findFirst: vi.fn().mockResolvedValue({ id: 'balance', quantity: 2, palletId: null }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), upsert: vi.fn() },
    stockMovement: { create: vi.fn().mockResolvedValue({ id: 'movement' }), createMany: vi.fn() },
    fbsTsdAssembly: { findFirst: vi.fn().mockResolvedValue(null) },
    shippedKizHistory: { findFirst: vi.fn().mockResolvedValue(null) },
    fbsWebKizStickerPrint: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const prisma: any = { ...tx, $transaction: (fn: any) => fn(tx) };
  const collection: any = { get: vi.fn().mockResolvedValue(request) };
  const service = new SkuSortingService(prisma, { requireClientAccess: vi.fn() } as any,
    { balanceKey: () => 'target-key' } as any, collection, {} as any, {} as any);
  const dto = { sourceBoxCode: 'BOX', targetBoxCode: 'TARGET', barcode: '123', kiz: 'kiz', auditBoxId: 'audit' };
  return { service, tx, dto, request };
}
describe('atomic SKU storage sorting', () => {
  it('registers an unrecorded physical KIZ only with this audit evidence and a free mark slot', async () => {
    // TEST: seven physical units with only four old marks must not create more stock or skip evidence.
    const { service, tx, dto } = fixture();
    dto.kiz = '0104680992593139215a%9RNyiE_KVd\u001d91EE12';
    tx.productMark.findFirst.mockResolvedValue(null);
    tx.productMark.count = vi.fn().mockResolvedValue(1);
    tx.productMark.create = vi.fn();
    tx.inventoryAuditBox.findUnique.mockResolvedValue({ boxId: 'box', clientId: 'client', status: 'MATCHED',
      startedAt: new Date('2026-09-05T10:00:00Z'), session: { warehouseId: 'warehouse' }, lines: [] });
    tx.auditLog = { findUnique: vi.fn().mockResolvedValue({ action: 'INVENTORY_KIZ_SCAN', payload: { boxId: 'box', skuId: 'sku' } }) };
    await service.move('request', dto as any, user);
    expect(tx.productMark.create.mock.calls[0][0].data).toMatchObject({ value: dto.kiz, status: 'AVAILABLE', boxId: 'target' });
    expect(tx.stockMovement.createMany.mock.calls[0][0].data.map((e: any) => e.quantity)).toEqual([-1, 1]);
    tx.auditLog.findUnique.mockResolvedValue(null);
    await expect(service.check('request', dto as any, user)).rejects.toThrow();
  });
  it('does not treat ACCEPT_AS_IS discrepancies as completed actualization', async () => {
    // TEST: RESOLVED alone does not prove that the actual count was applied.
    const { service, tx, dto } = fixture();
    tx.inventoryAuditBox.findUnique.mockResolvedValue({ boxId: 'box', clientId: 'client', status: 'RESOLVED', session: { warehouseId: 'warehouse' },
      lines: [{ skuId: 'sku', difference: -1, decision: 'KEEP_SYSTEM', decisionComment: '[ACCEPT_AS_IS]' }] });
    await expect(service.move('request', dto as any, user)).rejects.toThrow();
    expect(tx.stockBalance.upsert).not.toHaveBeenCalled();
  });
  it('preserves the existing full-inventory movement lock', async () => {
    // TEST: no new route can bypass an explicit full warehouse inventory lock.
    const { service, tx, dto } = fixture();
    tx.inventorySession.findFirst.mockResolvedValue({ id: 'full' });
    await expect(service.move('request', dto as any, user)).rejects.toThrow('инвентаризац');
    expect(tx.stockBalance.upsert).not.toHaveBeenCalled();
  });
  it('removes a zero-count source from the plan without fabricating stock', async () => {
    // TEST: completed actualization can reveal zero units; no KIZ scan is possible or required.
    const { service, tx, dto } = fixture();
    await service.ready('request', dto as any, user);
    expect(tx.skuCollectionSource.update).toHaveBeenCalledWith({ where: { id: 'source' }, data: { plannedQuantity: 0 } });
    expect(tx.stockBalance.upsert).not.toHaveBeenCalled();
  });
  it('writes balanced TRANSFER entries and records placement in the same operation', async () => {
    // TEST: selected units stay AVAILABLE; no PICK, RECEIPT or external stock write.
    const { service, tx, dto } = fixture();
    await service.move('request', dto as any, user);
    expect(tx.stockBalance.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { quantity: { decrement: 1 } } }));
    expect(tx.stockBalance.upsert.mock.calls[0][0].create).toMatchObject({ boxId: 'target', status: 'AVAILABLE', quantity: 1 });
    const entries = tx.stockMovement.createMany.mock.calls[0][0].data;
    expect(entries.map((e: any) => e.quantity)).toEqual([-1, 1]);
    expect(entries.every((e: any) => e.type === 'MOVE' && e.status === 'AVAILABLE')).toBe(true);
    expect(tx.skuCollectionScan.create.mock.calls[0][0].data).toMatchObject({ status: 'RECEIVED', targetBoxId: 'target' });
  });
  it('does not move the same KIZ twice and rejects a changed destination on retry', async () => {
    // TEST: lost HTTP response is a read-only retry, not a second decrement.
    const { service, tx, dto } = fixture();
    tx.skuCollectionScan.findUnique.mockResolvedValue({ status: 'RECEIVED', targetBoxCode: 'TARGET', sourceBoxCode: 'BOX', barcode: '123' });
    await service.move('request', dto as any, user);
    expect(tx.stockBalance.updateMany).not.toHaveBeenCalled();
    await expect(service.move('request', { ...dto, targetBoxCode: 'OTHER' } as any, user)).rejects.toThrow('уже');
  });
  it.each(['RESERVED', 'PACKING', 'SHIPPING'])('does not steal a %s KIZ for a new move', async (status) => {
    // TEST: physical possession is not authority to overwrite another order.
    const { service, tx, dto } = fixture();
    tx.productMark.findFirst.mockResolvedValue({ id: 'mark', boxId: 'box', skuId: 'sku', status });
    await expect(service.move('request', dto as any, user)).rejects.toThrow();
    expect(tx.stockBalance.updateMany).not.toHaveBeenCalled();
  });
  it('requires completed inventory and rejects an inventory of another box', async () => {
    // TEST: connecting screens must not bypass actualization.
    const { service, tx, dto } = fixture();
    tx.inventoryAuditBox.findUnique.mockResolvedValue({ boxId: 'other', clientId: 'client', status: 'MATCHED', session: { warehouseId: 'warehouse' }, lines: [] });
    await expect(service.move('request', dto as any, user)).rejects.toThrow();
    expect(tx.stockBalance.updateMany).not.toHaveBeenCalled();
  });
  it('fails closed when another operation consumed the last available unit', async () => {
    // TEST: AVAILABLE rechecked inside transaction; never creates stock from the route plan.
    const { service, tx, dto } = fixture();
    tx.stockBalance.findFirst.mockResolvedValue(null);
    await expect(service.move('request', dto as any, user)).rejects.toThrow();
    expect(tx.stockBalance.upsert).not.toHaveBeenCalled();
  });
  it('cannot run in another branch or with the feature disabled', async () => {
    // TEST: sold WMS and cross-branch stock remain untouched.
    const { service, dto } = fixture();
    await expect(service.move('request', dto as any, { ...user, activeWarehouseId: 'other' })).rejects.toThrow();
    vi.stubEnv('WMS_SKU_SORTING_ENABLED', 'false');
    await expect(service.move('request', dto as any, user)).rejects.toThrow();
  });
});

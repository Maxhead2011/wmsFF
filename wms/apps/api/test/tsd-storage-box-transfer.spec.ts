import { describe, expect, it, vi } from 'vitest';
import { BoxCodePolicyService } from '../src/common/boxes/box-code-policy.service';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

// TEST: box → barcode → KIZ → storage box, using the real stock transfer service.
const barcode = '2040000000001';
const kiz = '010460000000000121SERIAL-00001';
const user = {
  id: 'worker-1', deviceCode: 'TSD-01', roleCodes: ['OPERATOR'],
  permissionCodes: ['stock:write'], activeWarehouseId: 'wh-1',
  writableWarehouseIds: ['wh-1'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [],
} as any;

function fixture(initialMarkBox = 'source', markValue = kiz) {
  let sourceQuantity = 2;
  let targetQuantity = 0;
  let markBoxId = initialMarkBox;
  const oldBox = { id: 'old', code: 'FFL_OLD', clientId: 'client-1', warehouseId: 'wh-1', status: 'active' };
  const oldBalances: any[] = [];
  const auditRows: any[] = [];
  const mark = { id: 'mark-1', clientId: 'client-1', skuId: 'sku-1', value: markValue,
    status: 'AVAILABLE', stockMovementId: 'receipt-1', updatedAt: new Date('2026-07-20') };
  const sku = { id: 'sku-1', clientId: 'client-1', name: 'Костюм', internalSku: 'SKU-1',
    needsChestnyZnak: true, isUnmarked: false, barcodes: [{ value: barcode }] };
  const balance = () => ({ id: 'source-balance', skuId: sku.id, clientId: 'client-1',
    warehouseId: 'wh-1', boxId: 'source', status: 'AVAILABLE', quantity: sourceQuantity, sku });
  const source = () => ({ id: 'source', code: 'FFL_SOURCE', clientId: 'client-1',
    warehouseId: 'wh-1', status: 'active', client: { id: 'client-1' }, balances: [balance()] });
  const target = { id: 'target', code: 'SBOX_001', clientId: 'client-1', warehouseId: 'wh-1', status: 'active' };
  const movements = new Map<string, any>();
  const db = {
    box: {
      findUnique: vi.fn(async ({ where }: any) => {
        const code = where.code ?? where.clientId_code?.code;
        if (where.id === 'old') return oldBox;
        if (where.id === 'target') return target;
        return code === 'FFL_SOURCE' ? source() : code === target.code ? target : null;
      }),
      create: vi.fn(), update: vi.fn(),
    },
    sku: { findFirst: vi.fn(async () => sku) },
    productMark: {
      findFirst: vi.fn(async ({ where }: any) => (where.value?.equals ?? where.value) === mark.value &&
        (!where.clientId || where.clientId === mark.clientId) &&
        (!where.status || where.status === mark.status) &&
        (!where.boxId || where.boxId === markBoxId)
        ? { ...mark, boxId: markBoxId } : null),
      count: vi.fn(async () => markBoxId === 'source' ? 1 : 0),
      create: vi.fn(),
      update: vi.fn(async ({ data }: any) => { markBoxId = data.boxId; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.boxId !== markBoxId || where.status !== mark.status) return { count: 0 };
        markBoxId = data.boxId;
        return { count: 1 };
      }),
    },
    stockBalance: {
      findFirst: vi.fn(async ({ where }: any) => where.boxId === 'old'
        ? oldBalances.find(row => row.quantity !== 0) ?? null
        : where.boxId === 'target' ? (targetQuantity > 0 ? { quantity: targetQuantity } : null) : balance()),
      update: vi.fn(async ({ data }: any) => {
        sourceQuantity -= data.quantity.decrement;
        return balance();
      }),
      upsert: vi.fn(async ({ create }: any) => { targetQuantity += create.quantity; return { quantity: targetQuantity }; }),
      delete: vi.fn(),
      aggregate: vi.fn(async () => ({ _sum: { quantity: sourceQuantity } })),
    },
    stockMovement: {
      findUnique: vi.fn(async ({ where }: any) => movements.get(where.idempotencyKey) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { ...data, id: `movement-${movements.size}`, sku, box: target };
        movements.set(data.idempotencyKey, row);
        return row;
      }),
    },
    fbsTsdAssembly: { findFirst: vi.fn(async (_args: any): Promise<any> => null) },
    shippedKizHistory: { findFirst: vi.fn(async (_args: any): Promise<any> => null) },
    fbsWebKizStickerPrint: { findFirst: vi.fn(async (_args: any): Promise<any> => null) },
    auditLog: { create: vi.fn(async ({ data }: any) => { auditRows.push(data); return data; }) },
    $transaction: vi.fn(async (fn: any) => {
      const before = { sourceQuantity, targetQuantity, markBoxId, movements: new Map(movements), audits: [...auditRows] };
      try { return await fn(db); } catch (error) {
        ({ sourceQuantity, targetQuantity, markBoxId } = before);
        movements.clear(); before.movements.forEach((value, key) => movements.set(key, value));
        auditRows.splice(0, auditRows.length, ...before.audits);
        throw error;
      }
    }),
  };
  const codes = new BoxCodePolicyService({ get: vi.fn(async () => ({ storageBoxPrefix: 'SBOX_' })) } as never);
  const scopes = { requireClientAccess: vi.fn() };
  const service = new StockOperationsService(db as never, scopes as never,
    { balanceKey: () => 'target-key' } as never, undefined, undefined, undefined, codes);
  const payload = { transferMode: 'BOX_TO_STORAGE_BOX', fromBoxCode: 'FFL_SOURCE',
    toBoxCode: 'SBOX_001', barcode, scanCode: markValue, idempotencyKey: 'move-1' };
  return { service, codes, db, sku, target, payload, scopes, oldBox, oldBalances, mark, auditRows,
    quantities: () => [sourceQuantity, targetQuantity], markBox: () => markBoxId };
}

describe('TSD storage-box transfer', () => {
  it('accepts the configured storage prefix without loosening ordinary box validation', async () => {
    const { codes } = fixture();
    await expect((codes as any).requireStorageBox(' sbox_001 ')).resolves.toBe('SBOX_001');
    await expect(codes.requireAllowed('SBOX_001')).rejects.toThrow();
  });

  it('requires barcode then KIZ, without mutating marks during inspection', async () => {
    const { service, db, payload } = fixture();
    await expect(service.inspectTsdTransferItem({ ...payload, barcode: undefined, scanCode: barcode }, user))
      .resolves.toMatchObject({ state: 'SCAN_KIZ' });
    await expect(service.inspectTsdTransferItem(payload, user)).resolves.toMatchObject({ state: 'SCAN_TARGET' });
    expect(db.productMark.update).not.toHaveBeenCalled();
    expect(db.productMark.create).not.toHaveBeenCalled();
    expect(db.stockMovement.create).not.toHaveBeenCalled();
  });

  it('does not accept KIZ instead of the initial barcode', async () => {
    const { service, payload } = fixture();
    await expect(service.inspectTsdTransferItem({ ...payload, barcode: undefined }, user)).rejects.toThrow(/ШК/);
  });

  it('moves exactly one unit and the scanned mark, and does not repeat a completed request', async () => {
    const f = fixture();
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.markBox()).toBe('target');
    expect(f.db.stockMovement.create.mock.calls.map(([arg]) => arg.data.quantity)).toEqual([-1, 1]);
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.db.stockMovement.create).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing barcode', { barcode: '' }],
    ['wrong barcode', { barcode: '9999999999999' }],
    ['missing KIZ', { scanCode: barcode }],
    ['wrong KIZ', { scanCode: '010460000000000121UNKNOWN-0001' }],
    ['ordinary box rather than storage box', { toBoxCode: 'FFL_OTHER' }],
    ['prefix without number', { toBoxCode: 'SBOX_' }],
  ])('rejects %s without stock writes', async (_name, change) => {
    const f = fixture();
    await expect(f.service.executeTsdTransfer({ ...f.payload, ...change }, user)).rejects.toThrow();
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
    expect(f.db.stockBalance.update).not.toHaveBeenCalled();
  });

  it('rejects storage boxes belonging to a different client or branch', async () => {
    for (const change of [{ clientId: 'other-client' }, { warehouseId: 'other-warehouse' }]) {
      const f = fixture();
      Object.assign(f.target, change);
      await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
      expect(f.db.stockBalance.update).not.toHaveBeenCalled();
    }
  });

  it('cannot move the same KIZ again using another operation key', async () => {
    const f = fixture();
    await f.service.executeTsdTransfer(f.payload, user);
    await expect(f.service.executeTsdTransfer({ ...f.payload, idempotencyKey: 'move-2' }, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([1, 1]);
  });

  it('rejects a KIZ for another SKU before changing stock', async () => {
    const f = fixture();
    f.db.productMark.findFirst.mockResolvedValue({ id: 'mark-other', skuId: 'sku-other', boxId: 'source', status: 'AVAILABLE' });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
    expect(f.db.stockBalance.update).not.toHaveBeenCalled();
  });

  it('allows unmarked goods after barcode, without inventing a KIZ', async () => {
    const f = fixture();
    f.sku.needsChestnyZnak = false;
    f.sku.isUnmarked = true;
    f.db.productMark.count.mockResolvedValue(0);
    await expect(f.service.inspectTsdTransferItem({ ...f.payload, barcode: undefined, scanCode: barcode }, user))
      .resolves.toMatchObject({ state: 'SCAN_TARGET' });
    await expect(f.service.executeTsdTransfer({ ...f.payload, scanCode: barcode }, user))
      .resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.db.productMark.update).not.toHaveBeenCalled();
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('does not automatically bind a missing KIZ in the new mode', async () => {
    const f = fixture();
    await expect(f.service.inspectTsdTransferItem({ ...f.payload, scanCode: '010460000000000121MISSING-0001',
      bindMissingKiz: true, skuId: 'sku-1' }, user)).rejects.toThrow();
    expect(f.db.productMark.create).not.toHaveBeenCalled();
    expect(f.db.productMark.update).not.toHaveBeenCalled();
  });

  it('uses a custom configured prefix and rejects archived targets', async () => {
    const custom = new BoxCodePolicyService({ get: async () => ({ storageBoxPrefix: 'FFL_BOX_' }) } as never);
    await expect(custom.requireStorageBox('ffl_box_010')).resolves.toBe('FFL_BOX_010');
    await expect(custom.requireStorageBox('SBOX_010')).rejects.toThrow();
    const f = fixture();
    f.target.status = 'archived';
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/архив/);
    expect(f.db.stockBalance.update).not.toHaveBeenCalled();
  });
});

// TEST: inventory can correct quantities while a known KIZ remains on an empty old box.
describe('storage-box stale KIZ reconciliation', () => {
  it('accepts a known KIZ from an empty old box without writes during inspection', async () => {
    const f = fixture('old');
    await expect(f.service.inspectTsdTransferItem(f.payload, user)).resolves.toMatchObject({ state: 'SCAN_TARGET' });
    expect(f.markBox()).toBe('old');
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
    expect(f.db.auditLog.create).not.toHaveBeenCalled();
  });

  it('reconciles the mark and moves one physical unit atomically, with an audit and retry protection', async () => {
    const f = fixture('old');
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.oldBalances).toEqual([]);
    expect(f.markBox()).toBe('target');
    expect(f.db.productMark.create).not.toHaveBeenCalled();
    expect(f.auditRows).toEqual([expect.objectContaining({
      userId: user.id, entityId: 'mark-1', action: 'TSD_STORAGE_BOX_KIZ_RECONCILIATION',
      payload: expect.objectContaining({ previousBoxId: 'old', physicalBoxId: 'source',
        targetBoxId: 'target', kiz, deviceCode: 'TSD-01', idempotencyKey: 'move-1' }),
    })]);
    await expect(f.service.executeTsdTransfer(f.payload, user)).resolves.toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(f.quantities()).toEqual([1, 1]);
    expect(f.auditRows).toHaveLength(1);
  });

  it.each(['AVAILABLE', 'RESERVED', 'SHIPPING'])('rejects an old box with %s stock', async status => {
    const f = fixture('old'); f.oldBalances.push({ quantity: 1, status });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/старом коробе/);
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  });

  it.each(['RESERVED', 'SHIPPING'])('rejects a %s mark even when source quantity is available', async status => {
    const f = fixture('old'); f.mark.status = status;
    await expect(f.service.inspectTsdTransferItem(f.payload, user)).rejects.toThrow(/недоступен/);
  });

  it.each([{ clientId: 'other' }, { warehouseId: 'other' }, { warehouseId: null }])(
    'does not reconcile across client/branch boundaries: %j', async change => {
      const f = fixture('old'); Object.assign(f.oldBox, change);
      await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/клиент|филиал/);
      expect(f.quantities()).toEqual([2, 0]);
    });

  it('rejects a KIZ of another SKU, and never replaces another mark to make room', async () => {
    const wrong = fixture('old'); wrong.mark.skuId = 'other';
    await expect(wrong.service.inspectTsdTransferItem(wrong.payload, user)).rejects.toThrow(/не соответствует/);
    const full = fixture('old'); full.db.productMark.count.mockResolvedValue(2);
    await expect(full.service.executeTsdTransfer(full.payload, user)).rejects.toThrow(/привязаны/);
    expect(full.db.productMark.updateMany).not.toHaveBeenCalled();
  });

  it.each(['fbsTsdAssembly', 'shippedKizHistory', 'fbsWebKizStickerPrint'] as const)(
    'rejects a mark already referenced by %s', async model => {
      const f = fixture('old'); f.db[model].findFirst.mockResolvedValue({ id: 'used', orderId: '123' });
      await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/заказ|отгруж|этикет/);
      expect(f.db.stockMovement.create).not.toHaveBeenCalled();
    });

  it('rejects a box/SKU task even if its KIZ has not been scanned yet', async () => {
    const f = fixture('old');
    f.db.fbsTsdAssembly.findFirst.mockImplementation(async ({ where }: any) => where.kiz ? null : { id: 'reserved' });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/сборк/);
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  });

  it('rechecks protection after inspection, before any stock movement', async () => {
    const f = fixture('old');
    await f.service.inspectTsdTransferItem(f.payload, user);
    f.db.shippedKizHistory.findFirst.mockResolvedValue({ id: 'shipped-between-scans' });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([2, 0]);
  });

  it.each(['audit failure', 'concurrent mark change'])('rolls back the complete operation on %s', async fault => {
    const f = fixture('old');
    if (fault === 'audit failure') f.db.auditLog.create.mockRejectedValue(new Error('audit failure'));
    else f.db.productMark.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
    expect(f.quantities()).toEqual([2, 0]);
    expect(f.markBox()).toBe('old');
    expect(f.auditRows).toEqual([]);
    expect(f.db.productMark.updateMany).toHaveBeenCalledTimes(1);
  });

  it('leaves legacy inspection strict and unchanged', async () => {
    const f = fixture('old');
    await expect(f.service.inspectTsdTransferItem({ ...f.payload, transferMode: undefined }, user)).rejects.toThrow();
    expect(f.db.fbsTsdAssembly.findFirst).not.toHaveBeenCalled();
    expect(f.markBox()).toBe('old');
  });

  // TEST: GS/crypto bytes are retained; existing order ownership is checked by identity.
  it('protects a KIZ whose order record has a different crypto tail', async () => {
    const identity = '0104600000000001215TEST-serial1';
    const f = fixture('old', `${identity}\u001d91TEST\u001d92CRYPTO`);
    f.db.fbsTsdAssembly.findFirst.mockImplementation(async ({ where }: any) =>
      where.kiz?.startsWith === identity ? { id: 'existing-order' } : null);
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow(/заказ/);
    expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  });

  it('preserves the full KIZ including GS separators in the reconciliation audit', async () => {
    const fullKiz = '0104600000000001215TEST-serial1\u001d91TEST\u001d92CRYPTO';
    const f = fixture('old', fullKiz);
    await f.service.executeTsdTransfer(f.payload, user);
    expect(f.auditRows[0].payload.kiz).toBe(fullKiz);
    expect(f.mark.value).toBe(fullKiz);
  });

  it('does not accept a mark owned by another client or guess a missing old box', async () => {
    const foreign = fixture('old'); foreign.mark.clientId = 'other-client';
    await expect(foreign.service.inspectTsdTransferItem(foreign.payload, user)).rejects.toThrow(/не найден/);
    const missing = fixture('unknown-box');
    await expect(missing.service.inspectTsdTransferItem(missing.payload, user)).rejects.toThrow(/клиент|филиал/);
    expect(missing.db.productMark.create).not.toHaveBeenCalled();
  });

  it('does not bypass source client access', async () => {
    const f = fixture('old'); f.scopes.requireClientAccess.mockImplementation(() => { throw new Error('access denied'); });
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow('access denied');
    expect(f.db.productMark.findFirst).not.toHaveBeenCalled();
    expect(f.quantities()).toEqual([2, 0]);
  });

  it('keeps the old association when destination validation fails', async () => {
    const f = fixture('old'); f.target.clientId = 'other-client';
    await expect(f.service.executeTsdTransfer(f.payload, user)).rejects.toThrow();
    expect(f.markBox()).toBe('old');
    expect(f.auditRows).toEqual([]);
    expect(f.quantities()).toEqual([2, 0]);
  });
});

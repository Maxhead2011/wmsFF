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

function fixture() {
  let sourceQuantity = 2;
  let targetQuantity = 0;
  let markBoxId = 'source';
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
        return code === 'FFL_SOURCE' ? source() : code === target.code ? target : null;
      }),
      create: vi.fn(), update: vi.fn(),
    },
    sku: { findFirst: vi.fn(async () => sku) },
    productMark: {
      findFirst: vi.fn(async ({ where }: any) => where.value?.equals === kiz &&
        (!where.boxId || where.boxId === markBoxId)
        ? { id: 'mark-1', skuId: sku.id, boxId: markBoxId, status: 'AVAILABLE' } : null),
      count: vi.fn(async () => markBoxId === 'source' ? 1 : 0),
      create: vi.fn(),
      update: vi.fn(async ({ data }: any) => { markBoxId = data.boxId; }),
    },
    stockBalance: {
      findFirst: vi.fn(async () => balance()),
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
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  const codes = new BoxCodePolicyService({ get: vi.fn(async () => ({ storageBoxPrefix: 'SBOX_' })) } as never);
  const scopes = { requireClientAccess: vi.fn() };
  const service = new StockOperationsService(db as never, scopes as never,
    { balanceKey: () => 'target-key' } as never, undefined, undefined, undefined, codes);
  const payload = { transferMode: 'BOX_TO_STORAGE_BOX', fromBoxCode: 'FFL_SOURCE',
    toBoxCode: 'SBOX_001', barcode, scanCode: kiz, idempotencyKey: 'move-1' };
  return { service, codes, db, sku, target, payload, scopes,
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

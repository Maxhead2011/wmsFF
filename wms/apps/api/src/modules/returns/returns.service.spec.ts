import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnsService } from './returns.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
const user = { id: 'worker', name: 'Сотрудник', roleCodes: ['WORKER'], permissionCodes: ['stock:read', 'stock:write'], activeWarehouseId: 'w', warehouseIds: ['w'], writableWarehouseIds: ['w'], clientScopeMode: 'LIMITED', clientIds: ['c'], writableClientIds: ['c'] } as AuthUser;
function fixture() {
  const batch = { id: 'b', clientId: 'c', warehouseId: 'w', status: 'SORTING' };
  const units = [{ id: 'u', batchId: 'b', skuId: 's', boxId: 'box', boxCode: 'RETURN_01', condition: 'NORMAL', returnCode: 'WB-123', barcode: '0123456789012' }];
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    returnBatch: { findUnique: vi.fn(async () => batch), findUniqueOrThrow: vi.fn(async () => batch), update: vi.fn(async ({ data }) => Object.assign(batch, data)) },
    returnUnit: { findMany: vi.fn(async () => units), updateMany: vi.fn(), findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }) => data) },
    billingService: { upsert: vi.fn(async () => ({ id: 'svc', defaultPriceRub: null })) },
    clientBillingService: { findUnique: vi.fn(async () => ({ isActive: true, priceRub: 25, taxMode: 'INCLUDED' })) },
    stockMovement: { create: vi.fn() }, stockBalance: { upsert: vi.fn(), count: vi.fn(async () => 0) }, billingCharge: { create: vi.fn() },
    box: { findUnique: vi.fn(async () => ({ id: 'box', clientId: 'c', warehouseId: 'w', status: 'active' })), findUniqueOrThrow: vi.fn(async () => ({ id: 'box', clientId: 'c', warehouseId: 'w', status: 'active', palletId: null })) },
    sku: { findMany: vi.fn(async () => [{ id: 's', name: 'Костюм' }]) },
  };
  const db = { ...tx, $transaction: async (fn: (t: any) => unknown) => fn(tx) };
  return { service: new ReturnsService(db as never, new ClientScopeService()), tx, batch };
}
describe('returns transaction guards', () => {
  beforeEach(() => vi.stubEnv('WMS_RETURNS_PROCESSING_ENABLED', 'true'));
  afterEach(() => vi.unstubAllEnvs());
  // TEST: receipt and charge remain single after acknowledgement loss/retry.
  it('stores without KIZ and replays completion without another receipt or charge', async () => {
    const { service, tx } = fixture();
    await service.finish('b', user); await service.finish('b', user);
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.stockMovement.create.mock.calls[0][0].data).toMatchObject({ type: 'RETURN', status: 'QUARANTINE', quantity: 1, idempotencyKey: 'returns:receipt:u' });
    expect(tx.stockBalance.upsert.mock.calls[0][0].create).toMatchObject({ status: 'QUARANTINE', quantity: 1 });
    expect(tx.billingCharge.create).toHaveBeenCalledTimes(1);
    expect(tx.billingCharge.create.mock.calls[0][0].data).toMatchObject({ quantity: 1, totalRub: 25, sourceKey: 'returns:processing:b' });
  });
  it('rejects another warehouse before any warehouse writes', async () => {
    const { service, tx } = fixture();
    await expect(service.finish('b', { ...user, activeWarehouseId: 'other' })).rejects.toThrow();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });
  it('leaves sold installations disabled', async () => {
    vi.stubEnv('WMS_RETURNS_PROCESSING_ENABLED', 'false'); const { service, tx } = fixture();
    await expect(service.finish('b', user)).rejects.toThrow('не включена');
    expect(tx.billingCharge.create).not.toHaveBeenCalled();
  });
  it('rejects a previously scanned return rather than incrementing quantity', async () => {
    const { service, tx } = fixture();tx.returnUnit.findFirst.mockResolvedValue({ id: 'old' });
    await expect(service.scan('b', { id: 'new', marketplace: 'OZON', returnCode: '123', barcode: '0123', condition: 'NORMAL', boxCode: 'RETURN_01' }, user)).rejects.toThrow('уже зарегистрирован');
    expect(tx.returnUnit.create).not.toHaveBeenCalled();
  });
  it('does not accept an empty batch', async () => {
    const { service, tx } = fixture();tx.returnUnit.findMany.mockResolvedValue([]);
    await expect(service.finish('b', user)).rejects.toThrow('хотя бы один');expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });
  // TEST: a later receipt cannot silently mix with a pending return batch.
  it('rejects a box filled during sorting before any receipt or charge', async () => {
    const { service, tx } = fixture(); tx.stockBalance.count.mockResolvedValue(1);
    await expect(service.finish('b', user)).rejects.toThrow('уже появился остаток');
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.billingCharge.create).not.toHaveBeenCalled();
  });
});

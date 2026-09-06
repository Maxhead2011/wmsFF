import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxCodePolicyService } from '../src/common/boxes/box-code-policy.service';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => vi.unstubAllEnvs());

// TEST: both FBS KIZ relocation branches preserve a reusable source, but still move the mark.
describe('FBS permanent storage after KIZ relocation', () => {
  it.each([
    ['MOVED', true], ['MOVED', false], ['RELINKED', true], ['RELINKED', false],
  ])('%s, permanent source %s', async (mode, permanent) => {
    vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'true');
    const task = { id: 'task', clientId: 'client', requestId: 'request', orderId: 'order', skuId: 'sku',
      boxId: 'target', boxCode: 'FFL_TARGET', status: 'IN_PROGRESS', workerUserId: 'worker',
      deviceCode: 'TSD', updatedAt: new Date('2026-09-05T10:00:00Z') };
    const mark = { id: 'mark', clientId: 'client', skuId: 'sku', boxId: 'source', status: 'AVAILABLE',
      box: { id: 'source', code: permanent ? 'FFL_LKBBOX_014' : 'FFL_SOURCE', palletId: 'pallet' } };
    const tx = {
      fbsTsdAssembly: { findUnique: vi.fn(async () => task), update: vi.fn(async () => task) },
      productMark: { findUnique: vi.fn(async () => mark), update: vi.fn(), count: vi.fn(async () => 0) },
      box: { findUnique: vi.fn(async () => ({ id: 'target', code: 'FFL_TARGET', status: 'active', warehouseId: 'wh', palletId: null })), update: vi.fn() },
      stockBalance: { findFirst: vi.fn().mockResolvedValueOnce(mode === 'MOVED' ? { id: 'balance', quantity: 1, warehouseId: 'wh' } : null)
        .mockResolvedValueOnce({ id: 'target-balance', quantity: 1 }),
        delete: vi.fn(), update: vi.fn(), upsert: vi.fn(), count: vi.fn(async () => 0) },
      stockMovement: { create: vi.fn(async () => ({ id: 'movement' })) },
      clientRequestEvent: { create: vi.fn() },
    };
    const codes = new BoxCodePolicyService({ get: async () => ({ storageBoxAliases: ['FFL_LKBBOX'] }) } as never);
    const detach = { detachIfArchivedAndEmpty: vi.fn() };
    const service = new MarketplaceConnectionsService({ $transaction: async (fn: any) => fn(tx) } as never, {} as never);
    Object.assign(service, { boxCodes: codes, archivedEmptyBoxDetach: detach });
    const result = await (service as any).moveExistingFbsKizToOpenedBox(task, 'mark', 'source', 'KIZ', { id: 'worker', deviceCode: 'TSD' });
    expect(result.mode).toBe(mode);
    expect(tx.productMark.update).toHaveBeenCalledWith({ where: { id: 'mark' }, data: expect.objectContaining({ boxId: 'target' }) });
    expect(tx.box.update).toHaveBeenCalledTimes(permanent ? 0 : 1);
    expect(detach.detachIfArchivedAndEmpty).toHaveBeenCalledTimes(permanent ? 0 : 1);
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(mode === 'MOVED' ? 2 : 0);
  });
});

// TEST: the live last-pick cleanup must preserve reusable cells and their pallet/zone.
describe('FBS last pick from a refillable storage cell', () => {
  it.each([
    ['FFL_LKBBOX_014', 0, 0, true, false],
    ['SBOX_014', 0, 0, true, false],
    ['FFL_SOURCE', 0, 0, true, true],
    ['FFL_SOURCE', 1, 0, true, false],
    ['FFL_SOURCE', 0, 1, true, false],
    ['FFL_SOURCE', 0, 0, false, false],
  ])('%s, balances %s, marks %s, enabled %s', async (code, balances, marks, enabled, archive) => {
    vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', String(enabled));
    const source = { id: 'source', code, warehouseId: 'wh', palletId: 'pallet', zoneId: 'zone', status: 'active' };
    const tx = {
      box: { findUnique: vi.fn(async () => source), update: vi.fn(async ({ data }: any) => Object.assign(source, data)) },
      stockBalance: { findMany: vi.fn(async () => [{ id: 'available', quantity: 1, warehouseId: 'wh', boxId: 'source', palletId: 'pallet' }]),
        delete: vi.fn(), update: vi.fn(), upsert: vi.fn(), count: vi.fn(async () => balances) },
      stockMovement: { findMany: vi.fn(async () => []), create: vi.fn(async () => ({ id: 'movement' })) },
      productMark: { updateMany: vi.fn(async () => ({ count: 1 })), count: vi.fn(async () => marks) },
    };
    const service = new MarketplaceConnectionsService({} as never, {} as never);
    const detach = { detachIfArchivedAndEmpty: vi.fn() };
    Object.assign(service, { archivedEmptyBoxDetach: detach,
      boxCodes: new BoxCodePolicyService({ get: async () => ({ storageBoxAliases: ['FFL_LKBBOX'] }) } as never) });
    await (service as any).reserveCompletedWildberriesStock(tx, {
      id: 'task', marketplace: 'WILDBERRIES', completedAt: null, boxId: 'source', boxCode: code,
      itemCount: 1, clientId: 'client', skuId: 'sku', requestId: 'request', orderId: 'order', kiz: 'KIZ',
    }, 'wh');
    expect(tx.box.update).toHaveBeenCalledTimes(archive ? 1 : 0);
    expect(detach.detachIfArchivedAndEmpty).toHaveBeenCalledTimes(archive ? 1 : 0);
    if (!archive) expect(source).toMatchObject({ status: 'active', palletId: 'pallet', zoneId: 'zone' });
    expect(tx.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'PACKING', boxId: enabled ? null : 'source' },
    }));
  });
});

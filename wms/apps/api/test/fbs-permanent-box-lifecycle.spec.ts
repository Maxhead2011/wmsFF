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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: a known request with no eligible orders must not refresh a whole WB cabinet.
describe('empty local FBS box queue', () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    { enabled: true, saved: true, calls: 0 },
    { enabled: true, saved: false, calls: 1 },
    { enabled: false, saved: true, calls: 1 },
  ])('preserves legacy fallback only when required: %j', async ({ enabled, saved, calls }) => {
    vi.stubEnv('WMS_FBS_TSD_FAST_LOCAL_ENABLED', String(enabled));
    const findFirst = vi.fn().mockResolvedValue(saved ? { id: 'saved-link' } : null);
    const db = {
      stockBalance: { findMany: vi.fn().mockResolvedValue([{ skuId: 'sku', quantity: 1 }]) },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
      fbsOrderRequestLink: { findFirst },
    };
    const service = new MarketplaceConnectionsService(db as never, {} as never) as any;
    const local = vi.spyOn(service, 'loadFbsTsdRequestOrders').mockResolvedValue({ orders: [] });
    const live = vi.spyOn(service, 'loadFbsOrders').mockResolvedValue({ orders: [] });
    vi.spyOn(service, 'mergeSyncedFbsTsdRequestOrders').mockResolvedValue({ orders: [] });
    expect(await service.switchFbsTsdAssemblyToBox({ id: 'task', clientId: 'client', requestId: 'request',
      marketplace: 'WILDBERRIES', connectionId: 'connection' }, { id: 'box', code: 'FFL_BOX' }, {})).toBeNull();
    expect(local).toHaveBeenCalledWith('client', 'request', ['sku']);
    expect(local).toHaveBeenCalledWith('client', 'request');
    expect(live).toHaveBeenCalledTimes(calls);
    if (enabled) expect(findFirst).toHaveBeenCalledWith({ where: {
      clientId: 'client', requestId: 'request', connectionId: 'connection', marketplace: 'WILDBERRIES',
    }, select: { id: true } });
    else expect(findFirst).not.toHaveBeenCalled();
  });
});

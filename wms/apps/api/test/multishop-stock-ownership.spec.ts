import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertNotMultishopOwned } from '../src/modules/marketplace-connections/multishop-stock-ownership';
afterEach(() => vi.unstubAllEnvs());
describe('old stock writer ownership fence', () => {
  const db: any = { systemSetting: { findUnique: vi.fn() }, clientMarketplaceConnection: { findFirst: vi.fn(async () => ({ id: 'shop' })) } };
  // TEST: the common raw-write guard blocks manual, automatic and retry paths alike.
  it('blocks owned sizes through stopping, while preserving other sizes', async () => {
    vi.stubEnv('WMS_MULTISHOP_PUBLICATION_ENABLED', 'true');
    for (const status of ['ACTIVE', 'STOPPING', 'OFF']) {
      db.systemSetting.findUnique.mockResolvedValue({ value: { status, destinations: { a: { connectionId: 'shop', marketplace: 'WILDBERRIES', productId: '1:2' } } } });
      await expect(assertNotMultishopOwned(db, 'client', 'fixture', [2])).rejects.toThrow('группа');
      await expect(assertNotMultishopOwned(db, 'client', 'fixture', [3])).resolves.toBeUndefined();
    }
    db.systemSetting.findUnique.mockResolvedValue(null);
    await expect(assertNotMultishopOwned(db, 'client', 'fixture', [2])).resolves.toBeUndefined();
  });
  it('makes no database reads on an installation without the flag', async () => {
    vi.stubEnv('WMS_MULTISHOP_PUBLICATION_ENABLED', 'false'); db.systemSetting.findUnique.mockClear();
    await assertNotMultishopOwned(db, 'client', 'fixture', [2]);
    expect(db.systemSetting.findUnique).not.toHaveBeenCalled();
  });
});

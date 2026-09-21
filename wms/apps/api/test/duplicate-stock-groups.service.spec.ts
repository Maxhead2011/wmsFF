import { afterEach, describe, expect, it, vi } from 'vitest';
import { DuplicateStockGroupsService } from '../src/modules/marketplace-connections/duplicate-stock-groups.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import type { AuthUser } from '../src/modules/auth/auth.types';
import type { DuplicateGroup } from '../src/modules/marketplace-connections/duplicate-stock-groups';
const user = { id: 'u', roleCodes: ['CLIENT'], permissionCodes: ['clients:write'], clientIds: ['client'], writableClientIds: ['client'], clientScopeMode: 'LIMITED' } as AuthUser;
function fixture() {
  vi.stubEnv('WMS_DUPLICATE_STOCK_GROUPS_ENABLED', 'true');
  const group: DuplicateGroup = { id: 'g', name: 'Графит → чёрный', connectionId: 'wb', reserve: { mode: 'UNITS', value: 10 },
    shares: [{ targetKey: 'original', label: 'Графит', percent: 50 }, { targetKey: 'duplicate', label: 'Чёрный', percent: 50 }],
    variants: [{ sourceSkuId: 'source', targets: [{ targetKey: 'original', targetId: 'source', confirmed: true, requiresRelabel: false },
      { targetKey: 'duplicate', targetId: 'target', confirmed: true, requiresRelabel: true }] }], overrides: [] };
  const skus = ['source', 'target'].map(id => ({ id, article: id, clientSku: null, internalSku: id, name: id, color: id === 'source' ? 'Графит' : 'Чёрный', size: 'M', marketplaceProductId: '1:2', barcodes: [{ value: id }] }));
  const db: any = { systemSetting: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockImplementation(({ create, update }) => ({ value: create.value, updatedAt: update.updatedAt })) },
    sku: { findMany: vi.fn().mockResolvedValue(skus) }, client: { findUnique: vi.fn().mockResolvedValue({ relabelingEnabled: true }) },
    clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue([{ id: 'wb', marketplace: 'WILDBERRIES', isActive: true, fbsExecutionWarehouseId: 'warehouse' }]) },
    clientArticleMapping: { findMany: vi.fn().mockResolvedValue([{ sourceArticle: 'source', targetArticle: 'target' }]) },
    fbsStockPublication: { findMany: vi.fn().mockResolvedValue([]) }, auditLog: { create: vi.fn() }, $executeRaw: vi.fn() };
  db.$transaction = vi.fn(fn => fn(db));
  const marketplaces: any = { calculateFbsStockQuantities: vi.fn().mockResolvedValue(new Map([
    ['source', { available: 100, reserved: 20, sellable: 80 }], ['target', { available: 5, reserved: 0, sellable: 5 }],
  ])) };
  return { group, db, skus, marketplaces, service: new DuplicateStockGroupsService(db, new ClientScopeService(), marketplaces) };
}
afterEach(() => vi.unstubAllEnvs());
describe('duplicate stock groups API', () => {
  // TEST: the UI uses the existing relabel mapping even when customer color labels differ.
  it('saves confirmed relabel pairs with a revision and audit without changing publications', async () => {
    const f = fixture(); const saved = await f.service.save('client', { group: f.group, revision: null }, user);
    expect(saved.groups).toEqual([f.group]); expect(saved.publicationEnabled).toBe(false);
    expect(f.db.$executeRaw).toHaveBeenCalledOnce(); expect(f.db.auditLog.create).toHaveBeenCalledOnce();
    expect(f.marketplaces.calculateFbsStockQuantities).not.toHaveBeenCalled();
  });
  it('uses reserves before insurance before shares, and keeps target own stock separate', async () => {
    const f = fixture(); const result = await f.service.preview('client', { group: f.group }, user);
    expect(result.totalAllocated).toBe(70); expect(result.totalRelabel).toBe(35);
    expect(result.rows[0]).toMatchObject({ total: 100, reserved: 20, safetyReserve: 10 });
    expect(result.rows[0].targets.find(t => t.requiresRelabel)).toMatchObject({ quantity: 35, ownStock: 5 });
  });
  it('does not invent a second relabel mapping or accept mismatched sizes', async () => {
    const f = fixture(); f.db.clientArticleMapping.findMany.mockResolvedValue([]);
    await expect(f.service.save('client', { group: f.group, revision: null }, user)).rejects.toThrow('меню «Переклейка»');
    f.skus[1].size = 'L'; await expect(f.service.preview('client', { group: f.group }, user)).rejects.toThrow('размеры');
  });
  it('blocks stale revisions and overlapping groups', async () => {
    const f = fixture(); f.db.systemSetting.findUnique.mockResolvedValue({ updatedAt: new Date('2026-09-21'), value: { version: 1, groups: [{ ...f.group, id: 'other' }] } });
    await expect(f.service.save('client', { group: f.group, revision: null }, user)).rejects.toThrow('другим пользователем');
    await expect(f.service.save('client', { group: f.group, revision: '2026-09-21T00:00:00.000Z' }, user)).rejects.toThrow('другую группу');
    expect(f.db.systemSetting.upsert).not.toHaveBeenCalled();
  });
  it('keeps disabled VM and other clients inaccessible before querying data', async () => {
    const f = fixture(); await expect(f.service.read('other', user)).rejects.toThrow();
    vi.stubEnv('WMS_DUPLICATE_STOCK_GROUPS_ENABLED', 'false'); await expect(f.service.read('client', user)).rejects.toThrow('недоступно');
    expect(f.db.systemSetting.findUnique).not.toHaveBeenCalled();
  });
  it('checks employee warehouse scope', async () => {
    const f = fixture(); await expect(f.service.preview('client', { group: f.group }, { ...user, roleCodes: ['MANAGER'], activeWarehouseId: 'another' })).rejects.toThrow('филиал');
  });
  it('requires the marketplace budget for a client with Ozon instead of using full stock twice', async () => {
    const f = fixture(); f.db.clientMarketplaceConnection.findMany.mockResolvedValue([
      { id: 'wb', marketplace: 'WILDBERRIES', isActive: true, fbsExecutionWarehouseId: 'warehouse' },
      { id: 'ozon', marketplace: 'OZON', isActive: true, fbsExecutionWarehouseId: 'warehouse' },
    ]);
    await expect(f.service.preview('client', { group: f.group }, user)).rejects.toThrow('WB/Ozon');
    f.db.systemSetting.findUnique.mockImplementation(({ where }) => where.key.startsWith('marketplace.allocation.draft.') ? { value: { wbConnectionId: 'wb', ozonConnectionId: 'ozon', wbPercent: 60 } } : null);
    expect((await f.service.preview('client', { group: f.group }, user)).totalAllocated).toBe(42);
  });
  it('supports barcode search scoped to this client and a capped page', async () => {
    const f = fixture(); await f.service.catalog('client', { search: '001', page: 2 }, user);
    expect(f.db.sku.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: 'client' }), skip: 50, take: 51 }));
  });
  // TEST: the existing picker can choose another same-size source; do not hide this conflict.
  it('warns when relabel picking can choose a different physical source', async () => {
    const f = fixture();
    f.db.sku.findMany.mockResolvedValueOnce(f.skus).mockResolvedValueOnce([
      f.skus[0], { ...f.skus[0], id: 'alternative-source' },
    ]);
    const preview = await f.service.preview('client', { group: f.group }, user);
    expect(preview.pickingWarnings).toEqual([expect.objectContaining({ sourceSkuId: 'source', targetSkuId: 'target' })]);
    expect(preview.publicationEnabled).toBe(false);
  });
});

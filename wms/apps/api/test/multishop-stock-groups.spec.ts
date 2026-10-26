import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultishopStockGroupsService } from '../src/modules/marketplace-connections/multishop-stock-groups.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import type { AuthUser } from '../src/modules/auth/auth.types';

const admin: AuthUser = { id: 'admin', name: 'Admin', email: 'test@example.test', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] };
const config = { groups: [{ id: 'one', name: 'Пара 1', warehouseId: 'msk', lowStockThreshold: 2, members: [
  { connectionId: 'wb', percent: 50, priority: 0 }, { connectionId: 'ozon', percent: 50, priority: 1 },
] }], assignments: [{ skuId: 'sku', groupId: 'one' }] };
function fixture() {
  let saved: any = null;
  const prisma: any = {
    systemSetting: { findUnique: vi.fn(async () => saved), upsert: vi.fn(async ({ create }: any) => { saved = { ...create, updatedAt: new Date() }; return saved; }) },
    clientMarketplaceConnection: { findMany: vi.fn(async () => ['wb', 'ozon'].map(id => ({ id, fbsExecutionWarehouseId: 'msk' }))) },
    sku: { count: vi.fn(async () => 1), findMany: vi.fn(async () => []) }, auditLog: { create: vi.fn(async () => ({})) }, $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  };
  return { prisma, service: new MultishopStockGroupsService(prisma, new ClientScopeService()) };
}
describe('multi-shop settings', () => {
  beforeEach(() => vi.stubEnv('WMS_MULTISHOP_STOCK_ENABLED', 'true'));
  afterEach(() => vi.unstubAllEnvs());
  // TEST: sold installation never queries or changes group settings without explicit enablement.
  it('is disabled by default', async () => {
    vi.stubEnv('WMS_MULTISHOP_STOCK_ENABLED', 'false');
    const { service, prisma } = fixture();
    await expect(service.read('client', admin)).rejects.toThrow();
    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
  });
  it('saves one audited revision and rejects stale edits', async () => {
    const { service, prisma } = fixture();
    const first = await service.save('client', { revision: null, config }, admin);
    expect(first.publicationEnabled).toBe(false);
    expect(first.revision).toBeTruthy();
    await expect(service.save('client', { revision: null, config }, admin)).rejects.toThrow('другим пользователем');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });
  it('requires writable client scope, not just membership', async () => {
    const { service, prisma } = fixture();
    const reader = { ...admin, permissionCodes: [], roleCodes: ['CLIENT'], clientScopeMode: 'LIMITED' as const, clientIds: ['client'] };
    await expect(service.read('client', reader)).resolves.toBeDefined();
    await expect(service.save('client', { revision: null, config }, reader)).rejects.toThrow();
    await expect(service.read('other', reader)).rejects.toThrow();
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });
  it('rejects foreign SKUs without writing', async () => {
    const { service, prisma } = fixture();
    prisma.sku.count.mockResolvedValue(0);
    await expect(service.save('client', { revision: null, config }, admin)).rejects.toThrow('другому клиенту');
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });
  it('rejects duplicate SKU assignment without writing', async () => {
    const { service, prisma } = fixture();
    await expect(service.save('client', { revision: null, config: { ...config, assignments: [...config.assignments, ...config.assignments] } }, admin)).rejects.toThrow('уже назначен');
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });
  it('does not persist injected activation state', async () => {
    const { service } = fixture();
    const result = await service.save('client', { revision: null, config: { ...config, enabled: true } as any }, admin);
    expect(result.config).not.toHaveProperty('enabled');
  });
  // TEST: server whitelist retains mode/reserve and defaults old clients safely.
  it('persists shared mode and a single safety reserve', async () => {
    const { service } = fixture();
    const shared = { ...config, groups: config.groups.map(g => ({ ...g, mode: 'SHARED' as const, safetyReserve: 3 })) };
    const result = await service.save('client', { revision: null, config: shared }, admin);
    expect(result.config.groups[0]).toMatchObject({ mode: 'SHARED', safetyReserve: 3 });
    expect((await service.read('client', admin)).config.groups[0]).toMatchObject({ mode: 'SHARED', safetyReserve: 3 });
    expect(result.publicationEnabled).toBe(false);
  });
  it('defaults an older client to allocated mode without reserve', async () => {
    const { service } = fixture();
    const result = await service.save('client', { revision: null, config }, admin);
    expect(result.config.groups[0]).toMatchObject({ mode: 'ALLOCATED', safetyReserve: 0 });
  });
  it('constrains product search to client and page size', async () => {
    const { service, prisma } = fixture();
    await service.products('client', 'шк', 2, admin);
    expect(prisma.sku.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: 'client', isDraft: false }), take: 50, skip: 50 }));
  });
});

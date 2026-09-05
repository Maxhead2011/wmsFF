import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { MarketplaceStockControlService } from '../src/modules/marketplace-connections/marketplace-stock-control.service';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { WildberriesRequestScheduler } from '../src/modules/marketplace-connections/wildberries-request-scheduler';

const admin: AuthUser = { id: 'admin', name: 'Admin', email: 'admin@test', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] };

function fixture() {
  const values = new Map<string, boolean>();
  const prisma = {
    systemSetting: {
      findUnique: vi.fn(async ({ where }: any) => values.has(where.key) ? { value: values.get(where.key) } : null),
      findMany: vi.fn(async () => [...values].map(([key, value]) => ({ key, value, updatedBy: { name: 'Admin' }, updatedAt: new Date() }))),
      upsert: vi.fn(async ({ where, update }: any) => { values.set(where.key, update.value); return { updatedAt: new Date() }; }),
    },
    client: {
      findUnique: vi.fn(async ({ where }: any) => where.id === 'missing' ? null : ({ id: where.id, code: 'CL-1', name: 'Лукин' })),
      findMany: vi.fn(async () => [{ id: 'lukin', code: 'CL-1', name: 'Лукин' }, { id: 'other', code: 'CL-2', name: 'Другой' }]),
    },
    clientMarketplaceConnection: { findMany: vi.fn(async () => []) },
    auditLog: { create: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  };
  const scopes = new ClientScopeService();
  const control = new MarketplaceStockControlService(prisma as never, scopes);
  const marketplace = new MarketplaceConnectionsService(prisma as never, scopes);
  return { values, prisma, control, marketplace };
}

describe('Marketplace client stock control', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  // TEST: existing clients keep publication enabled; disabling one client does not affect another.
  it('defaults to enabled and isolates clients across disable/re-enable', async () => {
    const { control, prisma } = fixture();
    expect(await control.isEnabled('lukin')).toBe(true);
    await control.update('lukin', { enabled: false, expectedEnabled: true }, admin);
    expect(await control.isEnabled('lukin')).toBe(false);
    expect(await control.isEnabled('other')).toBe(true);
    await expect(control.assertEnabled('lukin')).rejects.toThrow('отключён');
    await control.update('lukin', { enabled: true, expectedEnabled: false }, admin);
    await expect(control.assertEnabled('lukin')).resolves.toBeUndefined();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'admin', entityId: 'lukin', payload: expect.objectContaining({ before: true, after: false }) }) }));
  });

  // TEST: the real outbound writer must not call the marketplace, including zeroing requests.
  it.each([0, 25])('blocks actual outbound stock amount %s before fetch', async (amount) => {
    const { control, marketplace } = fixture();
    await control.update('lukin', { enabled: false, expectedEnabled: true }, admin);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect((marketplace as any).putWildberriesStocks('lukin', 'test-token', '123', [{ chrtId: 456, amount }])).rejects.toThrow('отключён');
    expect(fetch).not.toHaveBeenCalled();
  });

  // TEST: the gate is refreshed for each batch and cannot use a cached enabled value.
  it('sends the existing payload when enabled and again after re-enabling', async () => {
    const { marketplace, control } = fixture();
    vi.spyOn(WildberriesRequestScheduler.prototype, 'waitForSlot').mockResolvedValue(undefined);
    const fetch = vi.fn(async () => new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetch);
    const send = () => (marketplace as any).putWildberriesStocks('lukin', 'test-token', '123', [{ chrtId: 456, amount: 25 }]);
    await send();
    await control.update('lukin', { enabled: false, expectedEnabled: true }, admin);
    await expect(send()).rejects.toThrow('отключён');
    await control.update('lukin', { enabled: true, expectedEnabled: false }, admin);
    await send();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith('https://marketplace-api.wildberries.ru/api/v3/stocks/123', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ stocks: [{ chrtId: 456, amount: 25 }] }) }));
  });

  // TEST: toggling while a publication waits for a WB slot must cancel dispatch.
  it('blocks a queued batch when control was disabled while waiting', async () => {
    const { marketplace, control } = fixture();
    vi.spyOn(WildberriesRequestScheduler.prototype, 'waitForSlot').mockImplementation(async () => {
      await control.update('lukin', { enabled: false, expectedEnabled: true }, admin);
    });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect((marketplace as any).putWildberriesStocks('lukin', 'test-token', '123', [{ chrtId: 456, amount: 25 }])).rejects.toThrow('отключён');
    expect(fetch).not.toHaveBeenCalled();
  });

  // TEST: a rate-limited write is not retried after the administrator disables control.
  it('blocks a 429 retry after disabling', async () => {
    const { marketplace, control } = fixture();
    vi.spyOn(WildberriesRequestScheduler.prototype, 'waitForSlot').mockResolvedValue(undefined);
    vi.spyOn(WildberriesRequestScheduler.prototype, 'defer').mockImplementation(() => undefined);
    const fetch = vi.fn(async () => {
      await control.update('lukin', { enabled: false, expectedEnabled: true }, admin);
      return new Response('{}', { status: 429 });
    });
    vi.stubGlobal('fetch', fetch);
    await expect((marketplace as any).putWildberriesStocks('lukin', 'test-token', '123', [{ chrtId: 456, amount: 25 }])).rejects.toThrow('отключён');
    expect(fetch).toHaveBeenCalledOnce();
  });

  // TEST: the gate is refreshed for each batch and cannot use a cached enabled value.
  it('rechecks after a toggle and fails closed on a database error', async () => {
    const { control, prisma } = fixture();
    await control.assertEnabled('lukin');
    await control.update('lukin', { enabled: false, expectedEnabled: true }, admin);
    await expect(control.assertEnabled('lukin')).rejects.toThrow('отключён');
    prisma.systemSetting.findUnique.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(control.assertEnabled('other')).rejects.toThrow('DB unavailable');
  });

  // TEST: no connection scans or remote stock reads are started by the stock job for a disabled client.
  it('skips the background stock job', async () => {
    const { control, marketplace, prisma } = fixture();
    await control.update('lukin', { enabled: false, expectedEnabled: true }, admin);
    await (marketplace as any).autoSyncFbsStocksForClient('lukin');
    expect(prisma.clientMarketplaceConnection.findMany).not.toHaveBeenCalled();
    await (marketplace as any).autoSyncFbsStocksForClient('other');
    expect(prisma.clientMarketplaceConnection.findMany).toHaveBeenCalledOnce();
  });

  // TEST: read-only, client and demo accounts cannot access a real administrator's switch.
  it.each([
    { ...admin, permissionCodes: ['stock:write'] },
    { ...admin, roleCodes: ['CLIENT'] },
    { ...admin, isDemo: true },
  ])('rejects an unauthorized actor before database writes', async (user) => {
    const { control, prisma } = fixture();
    await expect(control.update('lukin', { enabled: false, expectedEnabled: true }, user)).rejects.toThrow('администратору');
    await expect(control.list(user)).rejects.toThrow('администратору');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // TEST: reject stale tabs, missing clients and string booleans instead of silently changing state.
  it('validates input and rejects stale administrator state', async () => {
    const { control, prisma } = fixture();
    await expect(control.update('lukin', { enabled: 'false', expectedEnabled: true }, admin)).rejects.toThrow('true или false');
    await expect(control.update('missing', { enabled: false, expectedEnabled: true }, admin)).rejects.toThrow('Клиент не найден');
    await control.update('lukin', { enabled: false, expectedEnabled: true }, admin);
    await expect(control.update('lukin', { enabled: false, expectedEnabled: true }, admin)).rejects.toThrow('другой администратор');
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
  });

  // TEST: the administration list presents disabled and untouched clients with their real states.
  it('lists persisted states and the actor without marketplace credentials', async () => {
    const { control } = fixture();
    await control.update('lukin', { enabled: false, expectedEnabled: true }, admin);
    expect(await control.list(admin)).toEqual([
      expect.objectContaining({ id: 'lukin', enabled: false, updatedBy: 'Admin' }),
      expect.objectContaining({ id: 'other', enabled: true, updatedAt: null }),
    ]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import type { AuthUser } from '../src/modules/auth/auth.types';

// TEST: real WB gateway methods with fetch isolated; never contact a seller account.
describe('WB reshipment gateway', () => {
  beforeEach(() => vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED', 'true'));
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const user: AuthUser = { id: 'u', name: 'Admin', email: 'unit@example.invalid', roleCodes: ['ADMIN'], permissionCodes: [],
    clientScopeMode: 'ALL', clientIds: [], writableClientIds: [], activeWarehouseId: 'wh', writableWarehouseIds: ['wh'] };
  function fixture() {
    const connection = { id: 'wb', clientId: 'c', marketplace: 'WILDBERRIES', isActive: true, apiKey: 'unit-test-only' };
    const prisma = { clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue([connection]), findFirst: vi.fn().mockResolvedValue(connection) } };
    const scopes = { requireClientAccess: vi.fn() };
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const service = new MarketplaceConnectionsService(prisma as never, scopes as never);
    return { service, prisma, scopes, fetch };
  }
  const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
  const clientUser: AuthUser = { ...user, roleCodes: ['CLIENT'], permissionCodes: ['client-requests:write'],
    clientScopeMode: 'LIMITED', clientIds: ['c'], writableClientIds: ['c'] };
  // TEST: only the reshipment gateway is opened; the emergency assembly gateway remains privileged.
  it('allows a scoped client fresh reshipment status reads and preserves emergency denial', async () => {
    const f = fixture(); f.fetch.mockImplementation(async () => response({ orders: [{ id: 123, supplierStatus: 'confirm', wbStatus: 'waiting' }] }));
    expect(await f.service.readReshipmentWbStatuses('c', 'wb', ['123'], clientUser)).toEqual(new Map([['123', { supplierStatus: 'confirm', wbStatus: 'waiting' }]]));
    expect(f.prisma.clientMarketplaceConnection.findFirst).toHaveBeenCalledWith({ where: { id: 'wb', clientId: 'c', marketplace: 'WILDBERRIES', isActive: true } });
    f.fetch.mockClear();
    await expect(f.service.readRepeatAssemblyWbStatuses('c', 'wb', ['123'], clientUser)).rejects.toThrow('администратор');
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('allows scoped client discovery and supply creation without exposing credentials', async () => {
    const f = fixture(); f.fetch.mockImplementation(async (url: string) => response(url.endsWith('/reshipment') ? { orders: [{ orderID: 123, supplyID: 'old' }] } : { id: 'new' }));
    expect(await f.service.readReshipmentWbCandidates('c', clientUser)).toEqual([{ id: '123', connectionId: 'wb', supplyId: 'old' }]);
    expect(await f.service.createReshipmentWbSupply('c', 'wb', 'name', clientUser)).toBe('new');
  });
  it('rejects foreign client, missing permission, demo and forged connection before WB', async () => {
    const f = fixture();
    for (const auth of [{ ...clientUser, clientIds: [] }, { ...clientUser, writableClientIds: [] },
      { ...clientUser, permissionCodes: ['system:admin'] }, { ...clientUser, isDemo: true }]) {
      await expect(f.service.readReshipmentWbCandidates('c', auth)).rejects.toThrow();
    }
    await expect(f.service.createReshipmentWbSupply('foreign', 'wb', 'name', { ...clientUser, clientScopeMode: 'ALL', permissionCodes: [...clientUser.permissionCodes, 'system:admin'] })).rejects.toThrow();
    f.prisma.clientMarketplaceConnection.findFirst.mockResolvedValue(null);
    await expect(f.service.readReshipmentWbStatuses('c', 'foreign', ['123'], clientUser)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  // TEST: retain WB eligibility and independently read every fresh sticker identifier.
  it('reads transfer eligibility and fresh stickers without image or key leakage', async () => {
    const f = fixture(); f.fetch.mockResolvedValueOnce(response({ orders: [{ id: 123, supplierStatus: 'complete', wbStatus: 'waiting', isTransferable: true }] }));
    expect((await f.service.readReshipmentWbStatuses('c', 'wb', ['123'], user)).get('123')?.isTransferable).toBe(true);
    f.fetch.mockResolvedValueOnce(response({ stickers: [{ orderId: 123, barcode: '57884350051', file: 'image-data' }] }));
    expect(await f.service.readReshipmentWbStickers('c', 'wb', ['123'], user)).toEqual(new Map([['123', '57884350051']]));
    f.fetch.mockResolvedValueOnce(response({ stickers: [] }));
    await expect(f.service.readReshipmentWbStickers('c', 'wb', ['123'], user)).rejects.toThrow('всех');
    f.fetch.mockResolvedValueOnce(response({ stickers: [{ orderId: 456, barcode: '57884350051' }] }));
    await expect(f.service.readReshipmentWbStickers('c', 'wb', ['123'], user)).rejects.toThrow('некорректные');
  });

  it('discovers only WB reshipment IDs without refreshing or mutating WMS', async () => {
    const f = fixture(); f.fetch.mockResolvedValue(response({ orders: [{ orderID: 123, supplyID: 'WB-GI-old' }] }));
    expect(await f.service.readReshipmentWbCandidates('c', user)).toEqual([{ id: '123', connectionId: 'wb', supplyId: 'WB-GI-old' }]);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls[0][1].method).toBe('GET');
    expect(f.scopes.requireClientAccess).toHaveBeenCalledWith(user, 'c', 'write');
  });
  it('does not treat a malformed WB response as no orders', async () => {
    const f = fixture(); f.fetch.mockResolvedValue(response({ error: 'unexpected' }));
    await expect(f.service.readReshipmentWbCandidates('c', user)).rejects.toThrow();
  });
  it('rejects unsafe order ids from WB', async () => {
    const f = fixture(); f.fetch.mockResolvedValue(response({ orders: [{ orderID: 9007199254740992, supplyID: 'WB-GI-old' }] }));
    await expect(f.service.readReshipmentWbCandidates('c', user)).rejects.toThrow();
  });
  it('sold feature off cannot read or mutate WB', async () => {
    vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED', 'false'); const f = fixture();
    await expect(f.service.createReshipmentWbSupply('c', 'wb', 'WMS-RESHIP-test', user)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('enforces privileged user and connection ownership before network', async () => {
    const f = fixture();
    await expect(f.service.readReshipmentWbCandidates('c', { ...user, roleCodes: ['CLIENT'] })).rejects.toThrow();
    f.prisma.clientMarketplaceConnection.findFirst.mockResolvedValue(null);
    await expect(f.service.createReshipmentWbSupply('c', 'other', 'WMS-RESHIP-test', user)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('does not retry an ambiguous supply creation', async () => {
    const f = fixture(); f.fetch.mockRejectedValue(new Error('socket closed after server commit'));
    await expect(f.service.createReshipmentWbSupply('c', 'wb', 'WMS-RESHIP-test', user)).rejects.toThrow('socket');
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('uses an exact deterministic name and returns supply id', async () => {
    const f = fixture(); f.fetch.mockResolvedValue(response({ id: 'WB-GI-new' }));
    expect(await f.service.createReshipmentWbSupply('c', 'wb', 'WMS-RESHIP-test', user)).toBe('WB-GI-new');
    expect(JSON.parse(f.fetch.mock.calls[0][1].body)).toEqual({ name: 'WMS-RESHIP-test' });
  });
  it('finds a previously created named supply across pages and reads membership', async () => {
    const f = fixture(); f.fetch.mockImplementation(async (url: string) => {
      if (url.includes('next=0')) return response({ supplies: [{ id: 'WB-GI-no', name: 'other' }], next: 5 });
      if (url.includes('next=5')) return response({ supplies: [{ id: 'WB-GI-found', name: 'WMS-RESHIP-test' }], next: 0 });
      if (url.endsWith('/order-ids')) return response({ orderIds: [123] });
      return response({ id: 'WB-GI-found', done: false });
    });
    expect(await f.service.findReshipmentWbSupply('c', 'wb', 'WMS-RESHIP-test', user)).toEqual({ id: 'WB-GI-found', done: false, orderIds: ['123'] });
  });
  it('fails closed for duplicate deterministic supply names', async () => {
    const f = fixture(); f.fetch.mockResolvedValue(response({ supplies: [{ id: 'a', name: 'WMS-RESHIP-test' }, { id: 'b', name: 'WMS-RESHIP-test' }], next: 0 }));
    await expect(f.service.findReshipmentWbSupply('c', 'wb', 'WMS-RESHIP-test', user)).rejects.toThrow();
  });
  it('fails closed on looping pagination instead of reporting absent supply', async () => {
    const f = fixture(); f.fetch.mockResolvedValue(response({ supplies: [], next: 5 }));
    await expect(f.service.findReshipmentWbSupply('c', 'wb', 'WMS-RESHIP-test', user)).rejects.toThrow();
  });
  it('rejects missing membership or unverified closed state', async () => {
    const f = fixture(); f.fetch.mockImplementation(async (url: string) => response(url.endsWith('/order-ids') ? {} : { id: 'WB-GI-x', done: false }));
    await expect(f.service.readReshipmentWbSupply('c', 'wb', 'WB-GI-x', user)).rejects.toThrow();
  });
  it('PATCHes only exact selected numeric IDs once', async () => {
    const f = fixture(); f.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    await f.service.addReshipmentWbOrders('c', 'wb', 'WB-GI-new', ['123', '456'], user);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls[0][0]).toContain('/api/marketplace/v3/supplies/WB-GI-new/orders');
    expect(JSON.parse(f.fetch.mock.calls[0][1].body)).toEqual({ orders: [123,456] });
  });
  it('rejects duplicate or malformed order selections before PATCH', async () => {
    const f = fixture();
    await expect(f.service.addReshipmentWbOrders('c','wb','WB-GI-new',['123','123'],user)).rejects.toThrow();
    await expect(f.service.addReshipmentWbOrders('c','wb','WB-GI-new',['1e3'],user)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
});

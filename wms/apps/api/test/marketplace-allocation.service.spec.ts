import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceAllocationService } from '../src/modules/marketplace-connections/marketplace-allocation.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import type { AuthUser } from '../src/modules/auth/auth.types';

const user = { id: 'u', roleCodes: ['CLIENT'], permissionCodes: ['clients:write'], clientScopeMode: 'LIMITED', clientIds: ['c'], writableClientIds: ['c'] } as AuthUser;
const draft = { wbConnectionId: 'w', ozonConnectionId: 'o', wbPercent: 50 };
function fixture() {
  vi.stubEnv('WMS_MARKETPLACE_ALLOCATION_ENABLED', 'true');
  const connections = [
    { id: 'w', marketplace: 'WILDBERRIES', isActive: true, fbsExecutionWarehouseId: 'warehouse' },
    { id: 'o', marketplace: 'OZON', isActive: true, fbsExecutionWarehouseId: 'warehouse' },
  ];
  const prisma: any = { clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue(connections) },
    systemSetting: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ updatedAt: new Date('2026-09-21') }) },
    auditLog: { create: vi.fn() }, $executeRaw: vi.fn(), barcode: { findFirst: vi.fn().mockResolvedValue({ id: 'b' }) } };
  prisma.systemSetting.findMany = vi.fn().mockResolvedValue([]);
  prisma.$transaction = vi.fn((callback: any) => callback(prisma));
  const availability: any = { snapshot: vi.fn().mockResolvedValue({ generatedAt: 'now', missingBarcodeCount: 0,
    rows: [{ barcode: '001', total: 9, reserved: 6, available: 3 }] }) };
  return { prisma, availability, connections, service: new MarketplaceAllocationService(prisma, new ClientScopeService(), availability, {} as never) };
}
afterEach(() => vi.unstubAllEnvs());
describe('Marketplace allocation authorization and preparation', () => {
  // TEST: exact matches still require confirmation; stale catalogue and cross-source reuse cannot be accepted.
  it('requires explicit confirmation and a fresh cabinet-specific catalogue', async () => {
    const { service, prisma } = fixture();
    const body = { draft, sourceBarcode: '001', wbProductId: 'wp', ozonProductId: 'op', revision: null };
    await expect(service.confirmBinding('c', body, user)).rejects.toThrow('явно подтвердите');
    await expect(service.confirmBinding('c', { ...body, confirmed: true }, user)).rejects.toThrow('Обновите каталоги');
    const product = (productId: string) => ({ productId, offerId: productId, name: 'Товар', size: 'M', color: '', barcodes: ['001'] });
    prisma.systemSetting.findUnique.mockImplementation(({ where }: any) => where.key.includes('.catalog.')
      ? { value: { createdAt: new Date().toISOString(), products: [product(where.key.endsWith('.w') ? 'wp' : 'op')] } } : null);
    const result = await service.confirmBinding('c', { ...body, confirmed: true }, user);
    expect(result.sourceBarcode).toBe('001');
    expect(result.wb.productId).toBe('wp');
    expect(result.ozon.productId).toBe('op');
    prisma.systemSetting.findMany.mockResolvedValue([{ value: { wbConnectionId: 'w', wb: product('wp') } }]);
    await expect(service.confirmBinding('c', { ...body, confirmed: true }, user)).rejects.toThrow('другим исходным ШК');
  });
  // TEST: disabled feature/sold configuration and foreign client must fail before any database read.
  it('fails closed for the disabled feature and foreign clients', async () => {
    const { service, prisma } = fixture();
    await expect(service.read('foreign', user)).rejects.toThrow();
    vi.stubEnv('WMS_MARKETPLACE_ALLOCATION_ENABLED', 'false');
    await expect(service.read('c', user)).rejects.toThrow();
    expect(prisma.clientMarketplaceConnection.findMany).not.toHaveBeenCalled();
  });
  it('reads only safe connection fields, without loading stock on entry', async () => {
    const { service, prisma, availability } = fixture();
    expect((await service.read('c', user)).available).toBe(true);
    expect(prisma.clientMarketplaceConnection.findMany.mock.calls[0][0].where.clientId).toBe('c');
    expect(prisma.clientMarketplaceConnection.findMany.mock.calls[0][0].select.apiKey).toBeUndefined();
    expect(availability.snapshot).not.toHaveBeenCalled();
  });
  // TEST: split available, not gross physical stock; preserve barcode leading zeroes.
  it('previews the shared warehouse after reserve subtraction', async () => {
    const { service, availability } = fixture();
    const result = await service.preview('c', { draft }, user);
    expect(result.rows[0]).toEqual({ barcode: '001', total: 9, reserved: 6, available: 3, wb: 2, ozon: 1 });
    expect(availability.snapshot).toHaveBeenCalledWith('c', user, { warehouseId: 'warehouse' });
    expect(result.publicationEnabled).toBe(false);
  });
  it('refuses different physical warehouses and conflicting staff scope', async () => {
    const { service, connections, availability } = fixture();
    connections[1].fbsExecutionWarehouseId = 'other';
    await expect(service.preview('c', { draft }, user)).rejects.toThrow('один склад');
    connections[1].fbsExecutionWarehouseId = 'warehouse';
    await expect(service.preview('c', { draft }, { ...user, roleCodes: ['OPERATOR'], activeWarehouseId: 'other' })).rejects.toThrow();
    expect(availability.snapshot).not.toHaveBeenCalled();
  });
  // TEST: stale browser state and disabled connections cannot overwrite valid settings.
  it('checks revision under transaction lock and audits a successful save', async () => {
    const { service, prisma } = fixture();
    await expect(service.save('c', { draft, revision: 'stale' }, user)).rejects.toThrow('изменились');
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
    const result = await service.save('c', { draft, revision: null }, user);
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    expect(result.publicationEnabled).toBe(false);
  });
  it('invalidates saved settings when a cabinet disappears', async () => {
    const { service, prisma, connections } = fixture();
    prisma.systemSetting.findUnique.mockResolvedValue({ value: draft, updatedAt: new Date() });
    connections.pop();
    const result = await service.read('c', user);
    expect(result).toMatchObject({ available: false, invalidated: true, draft: null, message: 'Подключён только 1 кабинет' });
    await expect(service.save('c', { draft, revision: null }, user)).rejects.toThrow();
  });
});

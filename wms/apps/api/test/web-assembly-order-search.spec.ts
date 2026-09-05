import { describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { MarketplaceConnectionsController } from '../src/modules/marketplace-connections/marketplace-connections.controller';

function fixture() {
  const old = { id: 'old-print', orderId: '5630810674', assemblyId: 'assembly', printedAt: new Date('2025-01-01') };
  const prisma = {
    fbsWebKizStickerPrint: { findMany: vi.fn(async ({ where }: any) => where.orderId === old.orderId ? [old] : []) },
    fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
    sku: { findMany: vi.fn().mockResolvedValue([]) },
    clientRequest: { findMany: vi.fn().mockResolvedValue([]) },
    warehouseClient: { findMany: vi.fn().mockResolvedValue([{ clientId: 'branch-client' }]) },
  };
  const service = Object.assign(Object.create(MarketplaceConnectionsService.prototype), {
    prisma, clientScopes: { resolveClientFilter: vi.fn().mockReturnValue({ in: ['allowed-client'] }) },
  });
  const user = { clientScopeMode: 'LIMITED', clientIds: ['allowed-client'], activeWarehouseId: 'moscow' };
  return { service, prisma, user };
}

describe('web assembly order number search', () => {
  // TEST: filtering occurs in the database, before the latest-300 cap.
  it('finds an old print by exact trimmed number and preserves client scope', async () => {
    const { service, prisma, user } = fixture();
    const rows = await service.webOrderAssemblyHistory(user, ' 5630810674 ');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('old-print');
    expect(prisma.fbsWebKizStickerPrint.findMany).toHaveBeenCalledWith({
      where: { clientId: { in: ['allowed-client'] }, orderId: '5630810674' }, orderBy: { printedAt: 'desc' }, take: 300,
    });
  });
  // TEST: old callers retain the existing limit and access filter.
  it('keeps ordinary history unchanged for an empty search', async () => {
    const { service, prisma, user } = fixture();
    await service.webOrderAssemblyHistory(user, ' ');
    expect(prisma.fbsWebKizStickerPrint.findMany).toHaveBeenCalledWith({ where: { clientId: { in: ['allowed-client'] } }, orderBy: { printedAt: 'desc' }, take: 300 });
  });
  // TEST: branch-limited staff cannot expand the client scope through search.
  it('retains the existing branch-client fallback', async () => {
    const { service, prisma, user } = fixture();
    await service.webOrderAssemblyHistory({ ...user, clientIds: [] }, '5630810674');
    expect(prisma.fbsWebKizStickerPrint.findMany.mock.calls[0][0].where).toEqual({ clientId: { in: ['branch-client'] }, orderId: '5630810674' });
  });
  // TEST: invalid input must not silently return unrelated printable orders.
  it.each(['abc', '5630*', '1'.repeat(31)])('rejects malformed order number %s before querying', async query => {
    const { service, prisma, user } = fixture();
    await expect(service.webOrderAssemblyHistory(user, query)).rejects.toThrow('Номер заказа WB');
    expect(prisma.fbsWebKizStickerPrint.findMany).not.toHaveBeenCalled();
  });
  // TEST: query reaches the existing service, not a second print/assembly mechanism.
  it('forwards the optional query from the controller', async () => {
    const connections = { webOrderAssemblyHistory: vi.fn().mockResolvedValue([]) };
    const controller = Object.assign(Object.create(MarketplaceConnectionsController.prototype), { connections });
    const user = {} as any;
    await (controller.webOrderAssemblyHistory as any)(user, '5630810674');
    expect(connections.webOrderAssemblyHistory).toHaveBeenCalledWith(user, '5630810674');
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { ensureWmsAutoAssemblyAuthor, fbsRequestWarehouseName, WMS_AUTO_ASSEMBLY_AUTHOR_ID } from '../src/modules/marketplace-connections/fbs-request-identity';
afterEach(() => vi.unstubAllEnvs());
// TEST: selected-order fast refresh loses the warehouse name; routing restores it.
it.each([true, false])('keeps a named warehouse and correct author, automatic=%s', async automatic => {
  vi.stubEnv('WMS_AUTO_ASSEMBLY_ENABLED', 'true');
  const tx = {
    $executeRaw: vi.fn(),
    user: { upsert: vi.fn().mockResolvedValue({ id: WMS_AUTO_ASSEMBLY_AUTHOR_ID, name: 'WMS', status: 'BLOCKED', roles: [] }) },
    clientRequest: { create: vi.fn().mockResolvedValue({ id: 'request', number: 42 }) },
    clientRequestEvent: { create: vi.fn() },
    fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  };
  const db = { $transaction: (fn: any) => fn(tx), fbsOrderRequestLink: { findMany: vi.fn().mockResolvedValue([]) },
    fbsWarehouseRoutingRule: { findFirst: vi.fn().mockResolvedValue({ marketplaceWarehouseName: 'Москва Вешки' }) } };
  const service = new MarketplaceConnectionsService(db as never, { requireClientAccess: vi.fn() } as never);
  const order = { id: 'order', connectionId: 'cab', marketplace: 'WILDBERRIES', warehouseId: '1954106', warehouseName: null,
    category: 'active', itemCount: 1, barcodes: ['123'], product: { id: 'sku', name: 'Товар' } };
  vi.spyOn(service as any, 'resolveSelectedFbsOrders').mockResolvedValue({ orders: [order] });
  await (service as any).createFbsRequestUnlocked({ clientId: 'client', orders: [{ connectionId: 'cab', id: 'order' }] },
    { id: 'admin' }, { orders: [order] }, 'physical-warehouse', automatic ? { automatic: true, warehouseName: 'WB №1954106' } : undefined);
  expect(tx.clientRequest.create.mock.calls[0][0].data).toMatchObject({ title: 'FBS WB · Москва Вешки — 1 заказ(а/ов)',
    destinationCity: 'Маркетплейс FBS · Москва Вешки', warehouseId: 'physical-warehouse', createdByUserId: automatic ? WMS_AUTO_ASSEMBLY_AUTHOR_ID : 'admin' });
  expect(tx.clientRequestEvent.create.mock.calls[0][0].data).toMatchObject({ createdByUserId: 'admin',
    title: automatic ? 'Заявка создана автосборкой WMS' : 'Заявка создана из FBS-заказов' });
  expect(db.fbsWarehouseRoutingRule.findFirst.mock.calls[0][0].where).toEqual({ connectionId: 'cab', marketplaceWarehouseId: '1954106' });
  expect(tx.user.upsert).toHaveBeenCalledTimes(automatic ? 1 : 0);
  if (automatic) expect(tx.user.upsert.mock.calls[0][0].create).toMatchObject({ name: 'WMS', status: 'BLOCKED', passwordHash: '!SYSTEM-NO-LOGIN!' });
});
// TEST: names cannot silently become codes, and unknown warehouses remain explicit.
it('prefers real names and retains a truthful unknown fallback', () => {
  expect(fbsRequestWarehouseName('123', '123', 'WB №123', 'Волгоград')).toBe('Волгоград');
  expect(fbsRequestWarehouseName('123', ' Москва ', 'Волгоград')).toBe('Москва');
  expect(fbsRequestWarehouseName('123', null)).toBe('WB №123');
});
// TEST: an accidentally enabled/privileged identity cannot be used by automation.
it('rejects a privileged system author', async () => {
  const db = { user: { upsert: vi.fn().mockResolvedValue({ name: 'WMS', status: 'ACTIVE', roles: [] }) } };
  await expect(ensureWmsAutoAssemblyAuthor(db as never)).rejects.toThrow('служебная');
});

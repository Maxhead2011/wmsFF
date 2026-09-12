import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { fbsManagerDisposition } from '../src/modules/marketplace-connections/fbs-manager-decision';

afterEach(() => vi.unstubAllEnvs());

// TEST: run the actual background synchronization against both saved manager outcomes.
function fixture(disposition: 'SHIPMENT' | 'RETURN', enabled = true) {
  vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', String(enabled));
  const link: any = { id: 'link', clientId: 'client', requestId: 'request', marketplace: 'WILDBERRIES', connectionId: 'wb', orderId: '100',
    lastCategory: 'cancelled', lastSupplierStatus: 'cancel', lastWbStatus: 'canceled_by_client', lastSupplyId: 'supply', lastSkuId: 'sku',
    lastItemCount: 1, lastSeenAt: new Date(), syncStatus: `MANAGER_CONFIRMED_${disposition}`, syncIssue: null };
  const task: any = { id: 'task', requestId: 'request', requestItemId: 'item', clientId: 'client', skuId: 'sku',
    connectionId: 'wb', orderId: '100', productName: 'Suit', barcodes: ['001'], barcode: '001', kiz: 'physical-kiz',
    itemCount: 1, completedAt: new Date(), status: disposition === 'SHIPMENT' ? 'COMPLETED' : 'RETURN_REQUIRED' };
  const order: any = { id: '100', marketplace: 'WILDBERRIES', connectionId: 'wb', category: 'cancelled', supplierStatus: 'cancel',
    wbStatus: 'canceled_by_client', supplyId: 'supply', product: { id: 'sku', name: 'Suit' }, itemCount: 1, barcodes: ['001'], statusLabel: 'Отменён' };
  const request: any = { id: 'request', clientId: 'client', status: 'IN_WORK', title: 'FBS', comment: '', fbsOrderLinks: [link],
    items: [{ id: 'item', skuId: 'sku', name: 'Suit', barcode: '001', quantity: 1, comment: '', packageItems: [], boxSelections: [] }] };
  const tx: any = { clientRequest: { findUnique: vi.fn(async () => request), update: vi.fn() },
    fbsTsdAssembly: { findMany: vi.fn(async () => [task]), update: vi.fn() },
    fbsOrderRequestLink: { update: vi.fn() }, clientRequestItem: { update: vi.fn(), delete: vi.fn() },
    clientRequestEvent: { create: vi.fn() }, clientNotification: { create: vi.fn() },
    stockBalance: { update: vi.fn(), upsert: vi.fn() }, stockMovement: { create: vi.fn() }, productMark: { updateMany: vi.fn() } };
  const service: any = new MarketplaceConnectionsService({ ...tx, $transaction: (fn: any) => fn(tx) } as never, {} as never);
  return { task, link, tx, order, run: () => service.syncOneFbsRequest('client', 'request', new Map([['wb:100', order]]), []) };
}

describe('manager decisions survive WB synchronization', () => {
  it.each(['SHIPMENT', 'RETURN'] as const)('preserves %s without reopening the same conflict or changing stock', async disposition => {
    const f = fixture(disposition); await f.run();
    expect(f.tx.fbsTsdAssembly.update).not.toHaveBeenCalled();
    expect(f.tx.fbsOrderRequestLink.update).not.toHaveBeenCalled();
    expect(f.tx.clientNotification.create).not.toHaveBeenCalled();
    expect(f.tx.stockMovement.create).not.toHaveBeenCalled();
    expect(f.tx.stockBalance.upsert).not.toHaveBeenCalled();
    if (disposition === 'SHIPMENT') expect(f.tx.clientRequestItem.delete).not.toHaveBeenCalled();
    else expect(f.tx.clientRequestItem.delete).toHaveBeenCalledWith({ where: { id: 'item' } });
  });
  it('raises a fresh conflict when the marketplace changes after the decision', async () => {
    const f = fixture('SHIPMENT'); f.order.itemCount = 2; await f.run();
    expect(f.tx.fbsOrderRequestLink.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ syncStatus: 'RETURN_REQUIRED' }) }));
    expect(f.tx.clientNotification.create).toHaveBeenCalledOnce();
  });
  it('keeps the sold WMS synchronization behavior when the flag is disabled', async () => {
    const f = fixture('SHIPMENT', false); await f.run();
    expect(fbsManagerDisposition('MANAGER_CONFIRMED_SHIPMENT')).toBeUndefined();
    expect(f.tx.fbsOrderRequestLink.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ syncStatus: 'RETURN_REQUIRED' }) }));
  });
});

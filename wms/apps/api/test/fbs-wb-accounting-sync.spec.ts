import { describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: exercise the real background synchronization, including later WB transitions.
describe('WB accounting survives synchronization', () => {
  it.each(['sorted', 'waiting', 'canceled_by_client'])('does not resurrect collection after WB becomes %s', async wbStatus => {
    const link: any = { id: 'link', requestId: 'request', clientId: 'client', marketplace: 'WILDBERRIES', connectionId: 'wb',
      orderId: '100', lastSupplierStatus: 'complete', lastWbStatus: 'sorted', lastCategory: 'shipped', lastSupplyId: 'supply',
      syncStatus: 'WB_ACCOUNTED', lastSeenAt: new Date(), lastSkuId: 'sku', lastItemCount: 1 };
    const task: any = { id: 'task', requestId: 'request', requestItemId: 'item', clientId: 'client', connectionId: 'wb', orderId: '100',
      status: 'WB_ACCOUNTED', skuId: 'sku', productName: 'Suit', itemCount: 1, barcodes: ['001'], barcode: null, kiz: null, completedAt: null };
    const order: any = { id: '100', marketplace: 'WILDBERRIES', connectionId: 'wb',
      category: wbStatus === 'canceled_by_client' ? 'cancelled' : 'active', supplierStatus: 'complete', wbStatus,
      supplyId: 'other-supply', product: { id: 'other-sku', name: 'Changed product' }, barcodes: ['002'], itemCount: 1 };
    const request: any = { id: 'request', clientId: 'client', status: 'IN_WORK', title: 'FBS', comment: '', fbsOrderLinks: [link],
      items: [{ id: 'item', skuId: 'sku', name: 'Suit', barcode: '001', quantity: 1, comment: '', packageItems: [], boxSelections: [] }] };
    const tx: any = { clientRequest: { findUnique: vi.fn(async () => request), update: vi.fn() },
      fbsTsdAssembly: { findMany: vi.fn(async () => [task]), update: vi.fn() },
      fbsOrderRequestLink: { update: vi.fn() }, clientRequestItem: { update: vi.fn(), delete: vi.fn(), create: vi.fn() },
      clientRequestEvent: { create: vi.fn() }, clientNotification: { create: vi.fn() },
      stockBalance: { update: vi.fn() }, stockMovement: { create: vi.fn() }, productMark: { updateMany: vi.fn() } };
    const service: any = new MarketplaceConnectionsService({ ...tx, $transaction: (fn: any) => fn(tx) } as never, {} as never);
    await service.syncOneFbsRequest('client', 'request', new Map([['wb:100', order]]), []);
    expect(tx.fbsTsdAssembly.update).not.toHaveBeenCalled(); expect(tx.fbsOrderRequestLink.update).not.toHaveBeenCalled();
    expect(tx.clientRequestItem.delete).not.toHaveBeenCalled(); expect(tx.clientRequestItem.create).not.toHaveBeenCalled();
    expect(tx.stockBalance.update).not.toHaveBeenCalled(); expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.productMark.updateMany).not.toHaveBeenCalled();
  });
});

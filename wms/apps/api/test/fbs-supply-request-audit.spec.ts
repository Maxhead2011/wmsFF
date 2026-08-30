import { describe, expect, it } from 'vitest';

import { buildFbsSupplyRequestAudit } from '../src/modules/marketplace-connections/fbs-supply-request-audit';

describe('buildFbsSupplyRequestAudit', () => {
  it('reports missing and partially linked WB supplies while hiding complete ones', () => {
    // TEST: the audit must cover every active WB order with a supply, not a paginated web slice.
    const result = buildFbsSupplyRequestAudit({
      checkedAt: '2026-08-30T10:00:00.000Z',
      orders: [
        wbOrder('missing-1', 'WB-GI-MISSING'),
        wbOrder('missing-2', 'WB-GI-MISSING'),
        wbOrder('partial-1', 'WB-GI-PARTIAL'),
        wbOrder('partial-2', 'WB-GI-PARTIAL'),
        wbOrder('complete-1', 'WB-GI-COMPLETE'),
        wbOrder('without-supply', null),
        wbOrder('not-on-assembly', 'WB-GI-WAITING', 'new'),
      ],
      links: [
        requestLink('partial-1', 41),
        requestLink('complete-1', 42),
      ],
    });

    expect(result.checkedSupplies).toBe(3);
    expect(result.checkedOrders).toBe(5);
    expect(result.missingRequestSupplies).toBe(2);
    expect(result.issues).toEqual([
      expect.objectContaining({
        supplyId: 'WB-GI-MISSING',
        status: 'MISSING',
        activeOrderCount: 2,
        linkedOrderCount: 0,
        unlinkedOrderCount: 2,
        unlinkedOrderIds: ['missing-1', 'missing-2'],
        requestNumbers: [],
      }),
      expect.objectContaining({
        supplyId: 'WB-GI-PARTIAL',
        status: 'PARTIAL',
        activeOrderCount: 2,
        linkedOrderCount: 1,
        unlinkedOrderCount: 1,
        unlinkedOrderIds: ['partial-2'],
        requestNumbers: [41],
      }),
    ]);
  });

  it('does not count cancelled or removed request links as an existing request', () => {
    // TEST: a stale local link must not hide a WB supply that still needs a WMS request.
    const result = buildFbsSupplyRequestAudit({
      checkedAt: '2026-08-30T10:00:00.000Z',
      orders: [wbOrder('order-1', 'WB-GI-STALE')],
      links: [
        requestLink('order-1', 51, 'CANCELLED'),
        requestLink('order-1', 52, 'NEW', 'REMOVED'),
      ],
    });

    expect(result.issues).toEqual([
      expect.objectContaining({
        supplyId: 'WB-GI-STALE',
        status: 'MISSING',
        linkedOrderCount: 0,
        unlinkedOrderCount: 1,
      }),
    ]);
  });
});

function wbOrder(
  id: string,
  supplyId: string | null,
  supplierStatus = 'confirm',
) {
  return {
    id,
    connectionId: 'connection-1',
    accountName: 'Основной кабинет',
    marketplace: 'WILDBERRIES',
    category: 'active',
    supplierStatus,
    supplyId,
    warehouseId: '507',
    warehouseName: 'Коледино',
  } as const;
}

function requestLink(
  orderId: string,
  number: number,
  requestStatus = 'NEW',
  syncStatus = 'ACTIVE',
) {
  return {
    connectionId: 'connection-1',
    orderId,
    syncStatus,
    request: { number, status: requestStatus },
  };
}

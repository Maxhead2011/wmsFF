import { ClientStockBalanceMode, ClientRequestStatus, StockStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import {
  WmsStockAvailabilityService,
  wmsAvailableQuantity,
} from '../src/modules/stock/wms-stock-availability.service';

const user: AuthUser = {
  id: 'user-1',
  email: 'client@example.test',
  name: 'Клиент',
  roleCodes: ['CLIENT'],
  permissionCodes: ['stock:read'],
  clientScopeMode: 'LIMITED',
  clientIds: ['client-1'],
  writableClientIds: [],
};

describe('WMS stock availability source', () => {
  // TEST: total stock, reserve, duplicate barcode, zero/clamped values and a
  // picked unit already removed from AVAILABLE are calculated exactly once.
  it('aggregates one sellable row per barcode and subtracts the active reserve once', async () => {
    const prisma = prismaMock();
    const scopes = { requireClientAccess: vi.fn() };
    const config = { get: vi.fn(() => 2) };
    const service = new WmsStockAvailabilityService(prisma as never, scopes as never, config as never);

    const snapshot = await service.snapshot('client-1', user);

    expect(snapshot.rows).toEqual([
      { barcode: '000123456789', total: 10, reserved: 3, available: 7 },
      { barcode: 'DUP', total: 9, reserved: 2, available: 7 },
      { barcode: 'PICKED', total: 9, reserved: 2, available: 7 },
      { barcode: 'ZERO', total: 0, reserved: 4, available: 0 },
    ]);
    expect(snapshot.missingBarcodeCount).toBe(1);
    expect(snapshot.totals).toEqual({ total: 28, reserved: 11, available: 21, barcodes: 4 });
    expect(scopes.requireClientAccess).toHaveBeenCalledWith(user, 'client-1', 'read');

    const balanceWhere = prisma.stockBalance.groupBy.mock.calls[0][0].where;
    expect(balanceWhere.status).toBe(StockStatus.AVAILABLE);
    const serializedWhere = JSON.stringify(balanceWhere);
    expect(serializedWhere).toContain('storagePlacement');
    expect(serializedWhere).toContain('shipped');
    expect(serializedWhere).toContain('archived');
  });

  it('clamps only the final aggregate and never returns a negative quantity', () => {
    expect(wmsAvailableQuantity(10, 3)).toBe(7);
    expect(wmsAvailableQuantity(5, 5)).toBe(0);
    expect(wmsAvailableQuantity(2, 3)).toBe(0);
    expect(wmsAvailableQuantity(-2, 0)).toBe(0);
  });

  // ADDED: a warehouse selected in the report must scope both physical stock
  // and active reservations, otherwise the Excel total would mix branches.
  it('applies the requested warehouse to stock and reservation queries', async () => {
    const prisma = prismaMock();
    const service = new WmsStockAvailabilityService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
      { get: vi.fn(() => 2) } as never,
    );

    await service.snapshot('client-1', user, { warehouseId: 'warehouse-1' });

    expect(JSON.stringify(prisma.stockBalance.groupBy.mock.calls[0][0].where)).toContain('warehouse-1');
    expect(prisma.clientRequestItem.groupBy.mock.calls[0][0].where.request.warehouseId).toBe('warehouse-1');
  });
});

function prismaMock() {
  const skus = [
    sku('a', '000123456789'),
    sku('b', 'DUP'),
    sku('c', 'DUP'),
    sku('d', 'PICKED'),
    sku('e', 'ZERO'),
    sku('f', null),
  ];
  const totals = new Map([['a', 10], ['b', 4], ['c', 5], ['d', 9]]);
  const reserves = new Map([['a', 3], ['b', 1], ['c', 1], ['d', 3], ['e', 4]]);
  const picked = new Map([['d', 1]]);

  return {
    client: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'client-1',
        storesWithoutBoxes: false,
        stockBalanceMode: ClientStockBalanceMode.PALLET_SORT,
      }),
    },
    sku: {
      findMany: vi.fn().mockImplementation(({ where, take }: { where: { id?: { gt?: string } }; take: number }) => {
        const start = where.id?.gt ? skus.findIndex((item) => item.id === where.id!.gt) + 1 : 0;
        return Promise.resolve(skus.slice(start, start + take));
      }),
    },
    stockBalance: {
      groupBy: vi.fn().mockImplementation(({ where }: { where: { skuId: { in: string[] } } }) => Promise.resolve(
        where.skuId.in
          .filter((skuId) => totals.has(skuId))
          .map((skuId) => ({ skuId, _sum: { quantity: totals.get(skuId) } })),
      )),
    },
    clientRequestItem: {
      groupBy: vi.fn().mockImplementation(({ where }: { where: { skuId: { in: string[] } } }) => Promise.resolve(
        where.skuId.in
          .filter((skuId) => reserves.has(skuId))
          .map((skuId) => ({
            requestId: `request-${skuId}`,
            skuId,
            barcode: null,
            _sum: { quantity: reserves.get(skuId) },
          })),
      )),
    },
    stockMovement: {
      groupBy: vi.fn().mockImplementation(({ where }: { where: { skuId: { in: string[] } } }) => Promise.resolve(
        where.skuId.in
          .filter((skuId) => picked.has(skuId))
          .map((skuId) => ({
            sourceDocument: `request-${skuId}`,
            skuId,
            _sum: { quantity: picked.get(skuId) },
          })),
      )),
    },
  };
}

function sku(id: string, barcode: string | null) {
  return {
    id,
    barcodes: barcode ? [{ value: barcode, isPrimary: true }] : [],
  };
}

// Keep enum imports exercised so a future status rename breaks this contract.
expect(ClientRequestStatus.IN_WORK).toBe('IN_WORK');
